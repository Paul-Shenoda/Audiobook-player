import { updateBook as defaultUpdateBook } from '../storage/library-db.js';
import { formatTime } from '../utils/format-time.js';

/**
 * Bookmarks live on the book record (`book.bookmarks`), newest first.
 * Audio bookmarks store `{ trackIndex, seconds }` (position in the file),
 * EPUB bookmarks store `{ chapterIndex, chunkIndex }`. These helpers also keep
 * the in-memory book object current so a re-opened sheet shows the change.
 *
 * @typedef {import('../storage/library-db.js').Book} Book
 * @typedef {import('./player-store.js').PlayerState} PlayerState
 */

const SNIPPET_LENGTH = 60;

/** @param {Book} book */
export function getBookmarks(book) {
  return book.bookmarks ?? [];
}

/**
 * The time and chapter name a bookmark made right now would show.
 * @param {PlayerState} state
 */
export function describeNow(state) {
  const chapterName = state.chapters[state.chapterIndex]?.title || `Chapter ${state.chapterIndex + 1}`;
  return { time: formatTime(state.chapterElapsed), chapterName };
}

/**
 * @param {PlayerState} state
 * @returns {object} a bookmark for the current position
 */
export function bookmarkFromState(state) {
  const { time, chapterName } = describeNow(state);
  const base = { id: crypto.randomUUID(), createdAt: Date.now() };
  if (state.kind === 'audio') {
    return { ...base, label: `${chapterName} at ${time}`, trackIndex: state.trackIndex ?? 0, seconds: state.trackSeconds ?? 0 };
  }
  const chunkIndex = state.readAlong?.chunkIndex ?? 0;
  const snippet = (state.readAlong?.chunks[chunkIndex] || '').trim().slice(0, SNIPPET_LENGTH);
  const label = snippet ? `${chapterName} — "${snippet}${snippet.length === SNIPPET_LENGTH ? '…' : ''}"` : chapterName;
  return { ...base, label, chapterIndex: state.chapterIndex, chunkIndex };
}

/**
 * @param {Book} book
 * @param {PlayerState} state
 * @param {typeof defaultUpdateBook} [save]
 */
export function addBookmark(book, state, save = defaultUpdateBook) {
  const bookmark = bookmarkFromState(state);
  book.bookmarks = [bookmark, ...getBookmarks(book)];
  save(book.id, { bookmarks: book.bookmarks }).catch(err => console.warn('Could not save bookmark', err));
  return bookmark;
}

/**
 * @param {Book} book
 * @param {string} id
 * @param {typeof defaultUpdateBook} [save]
 */
export function removeBookmark(book, id, save = defaultUpdateBook) {
  book.bookmarks = getBookmarks(book).filter(b => b.id !== id);
  save(book.id, { bookmarks: book.bookmarks }).catch(err => console.warn('Could not save bookmarks', err));
}

/** Seek to a position (seconds) in the current file, switching embedded chapter first if needed. */
function seekInFile(store, seconds) {
  const { book, chapterIndex } = store.getState();
  const tracks = book.tracks ?? [];
  const fileChapters = tracks.length === 1 ? (tracks[0]?.chapters ?? []) : [];
  let start = 0;
  if (fileChapters.length > 1) {
    let idx = 0;
    for (let i = 0; i < fileChapters.length; i += 1) {
      if (fileChapters[i].startSeconds <= seconds) idx = i;
      else break;
    }
    if (idx !== chapterIndex) store.goToChapter(idx);
    start = fileChapters[idx].startSeconds;
  }
  const length = store.getState().chapterDuration;
  if (length > 0) store.seekInChapter((seconds - start) / length);
}

/**
 * Run `attempt` with each new state until it returns true; gives up if another book loads.
 * @param {ReturnType<typeof import('./player-store.js').createPlayerStore>} store
 * @param {(s: PlayerState) => boolean} attempt
 */
function whenReady(store, attempt) {
  const bookId = store.getState().book?.id;
  const stop = store.subscribe(s => {
    if (s.book?.id !== bookId || attempt(s)) stop();
  });
}

/**
 * Jump to a bookmark and play from there, loading its file or chapter first if needed.
 * @param {ReturnType<typeof import('./player-store.js').createPlayerStore>} store
 * @param {{ trackIndex?: number, seconds?: number, chapterIndex?: number, chunkIndex?: number }} bm
 */
export function jumpToBookmark(store, bm) {
  const s = store.getState();
  if (s.kind === 'audio') {
    const trackIndex = bm.trackIndex ?? 0;
    const seconds = bm.seconds ?? 0;
    if (trackIndex === s.trackIndex) {
      seekInFile(store, seconds);
      store.play();
      return;
    }
    store.goToChapter(trackIndex);
    // The new file's length is unknown until its metadata loads.
    whenReady(store, next => {
      if (next.trackIndex !== trackIndex || !(next.trackDuration > 0)) return false;
      seekInFile(store, seconds);
      store.play();
      return true;
    });
    return;
  }

  const chapterIndex = bm.chapterIndex ?? 0;
  const seekWhenLoaded = next => {
    const chunks = next.readAlong?.chunks;
    if (next.status === 'loading' || next.chapterIndex !== chapterIndex || !chunks?.length) return false;
    store.seekInChapter((Math.min(bm.chunkIndex ?? 0, chunks.length - 1) + 0.5) / chunks.length);
    store.play();
    return true;
  };
  if (seekWhenLoaded(s)) return;
  whenReady(store, seekWhenLoaded);
  store.goToChapter(chapterIndex);
}
