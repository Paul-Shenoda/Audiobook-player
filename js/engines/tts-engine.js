import { clampSpeed, EPUB_MAX_SPEED } from '../utils/playback-speed.js';
import {
  openEpub,
  loadChapterText,
  destroyEpub,
  findFirstContentChapter,
  getChapterList,
} from '../epub/epub-loader.js';
import { chunkText } from '../epub/text-extract.js';
import {
  saveEpubProgress,
  loadEpubProgress,
  estimatePercent,
  estimateSecondsRemaining,
} from '../tts/playback-state.js';
import { loadTTSSettings, sharedTtsRouter } from '../tts/tts-router.js';
import { createSleepTimer } from '../services/sleep-timer.js';
import { getBook, updateBook } from '../storage/library-db.js';

/**
 * @typedef {import('../storage/library-db.js').Book} Book
 * @typedef {import('./../services/player-store.js').PlayerEngine} PlayerEngine
 */

/**
 * Safari has a long-standing IndexedDB bug where a Blob retrieved from a
 * previous read throws `NotFoundError: The object can not be found here`
 * when its contents are actually accessed — re-fetching the record fresh
 * and retrying once often succeeds where reusing the already-stale Blob
 * reference does not. Falls through to the original error if the retry
 * also fails (including if the book was deleted in the meantime).
 * @param {Book} currentBook
 * @returns {Promise<ArrayBuffer>}
 */
async function readFileBlobArrayBuffer(currentBook) {
  try {
    return await currentBook.fileBlob.arrayBuffer();
  } catch (err) {
    if (!(err instanceof DOMException) || err.name !== 'NotFoundError') throw err;
    const fresh = await getBook(currentBook.id);
    if (!fresh?.fileBlob) throw err;
    return await fresh.fileBlob.arrayBuffer();
  }
}

/**
 * EPUB playback: text chunks read aloud through the TTS router.
 * Every dependency can be injected so tests need no real EPUB or speech.
 * @param {Object} [deps]
 * @returns {PlayerEngine & { whenIdle: () => Promise<void> }}
 */
export function createTtsEngine(deps = {}) {
  const {
    router = sharedTtsRouter,
    readBlob = readFileBlobArrayBuffer,
    openEpub: open = openEpub,
    getChapterList: listChapters = getChapterList,
    findFirstContentChapter: findFirst = findFirstContentChapter,
    loadChapterText: loadText = loadChapterText,
    chunkText: chunk = chunkText,
    destroyEpub: destroyBook = destroyEpub,
    updateBook: saveBook = updateBook,
    loadSettings = loadTTSSettings,
  } = deps;

  /** @type {Book|null} */
  let book = null;
  let emit = () => {};
  let epub = null;
  let destroyed = false;
  let totalChapters = 0;
  /** @type {import('../epub/epub-loader.js').ChapterEntry[]} */
  let chapterList = [];
  let chapterIndex = 0;
  /** @type {string[]} */
  let chunks = [];
  let chunkIndex = 0;
  let rate = 1;
  /** True from play() until pause, error or the end of the book. */
  let wantPlaying = false;
  const sleepTimer = createSleepTimer({
    onExpire: () => {
      enqueue(() => {
        wantPlaying = false;
        router.pause();
        publish({ status: 'paused', sleep: { mode: 'off' } });
      });
    },
  });
  /** Last queued command; null when idle. Commands run one at a time, in order. */
  let tail = null;

  function reportError(err) {
    emit({ status: 'error', error: err instanceof Error ? err.message : String(err) });
  }

  /** Run `fn` now if idle (keeps the user-gesture call chain short), else after the previous command. */
  function enqueue(fn) {
    const exec = () => {
      try {
        return Promise.resolve(fn());
      } catch (err) {
        return Promise.reject(err);
      }
    };
    const p = (tail ? tail.then(exec) : exec()).catch(reportError);
    tail = p;
    p.then(() => {
      if (tail === p) tail = null;
    });
  }

  function publish(extra = {}) {
    const duration = estimateSecondsRemaining(chunks, 0, rate);
    const remaining = estimateSecondsRemaining(chunks, chunkIndex, rate);
    emit({
      rate,
      chapterIndex,
      chapterElapsed: Math.max(0, duration - remaining),
      chapterDuration: duration,
      bookPercent: estimatePercent(chapterIndex, totalChapters, chunkIndex, chunks.length),
      readAlong: { chunks, chunkIndex },
      ...extra,
    });
  }

  function persistProgress() {
    const percent = estimatePercent(chapterIndex, totalChapters, chunkIndex, chunks.length);
    saveEpubProgress(book.id, { chapterIndex, chunkIndex, charOffset: 0 });
    saveBook(book.id, {
      lastOpenedAt: Date.now(),
      progress: { chapterIndex, chunkIndex, percent },
    })?.catch?.(err => console.warn('Could not save progress', err));
  }

  function chapterTitle(i) {
    const entry = chapterList[i];
    return entry?.hasTocLabel ? entry.label : `Chapter ${i + 1} of ${totalChapters}`;
  }

  /** Load a chapter's text and park at `startChunk` (-1 = last chunk). */
  async function loadChapter(index, startChunk = 0) {
    const text = await loadText(epub, index);
    if (destroyed) return;
    chapterIndex = index;
    chunks = chunk(text);
    chunkIndex = startChunk < 0 ? Math.max(chunks.length - 1, 0) : Math.min(startChunk, Math.max(chunks.length - 1, 0));
  }

  async function speakFrom(index) {
    if (!chunks.length) {
      wantPlaying = false;
      publish({ status: 'paused', error: 'This chapter has no readable text' });
      return;
    }
    chunkIndex = index;
    await router.speak(chunks, index, { bookId: book.id, chapterIndex });
  }

  /** Move to a position in the chapter that is already loaded. */
  async function positionAt(index) {
    chunkIndex = Math.min(Math.max(index, 0), Math.max(chunks.length - 1, 0));
    if (wantPlaying) {
      await speakFrom(chunkIndex);
    } else {
      router.stop(); // drop any paused speech so the next play() starts here
      persistProgress();
      publish();
    }
  }

  /** Load another chapter; keep playing if we were. */
  async function jumpToChapter(index, startChunk = 0) {
    const resume = wantPlaying;
    router.stop();
    await loadChapter(index, startChunk);
    if (destroyed) return;
    persistProgress();
    publish({ error: null });
    if (resume) await speakFrom(chunkIndex);
    else publish({ status: 'paused' });
  }

  function handleChunkStart(index) {
    if (destroyed) return;
    chunkIndex = index;
    persistProgress();
    publish({ status: 'playing', error: null });
  }

  function handleComplete() {
    if (destroyed) return;
    enqueue(async () => {
      const atEnd = chapterIndex >= totalChapters - 1;
      const sleepAtChapterEnd = sleepTimer.getMode() === 'chapter';

      if (atEnd || sleepAtChapterEnd) {
        wantPlaying = false;
        if (atEnd) {
          saveBook(book.id, { finishedAt: Date.now() })?.catch?.(() => {});
          publish({ status: 'paused', sleep: sleepTimer.set('off') });
          return;
        }
        // Sleep timer: park at the start of the next chapter.
        const sleep = sleepTimer.set('off');
        await loadChapter(chapterIndex + 1);
        if (destroyed) return;
        persistProgress();
        publish({ status: 'paused', sleep });
        return;
      }

      // Continuous playback: roll straight into the next chapter.
      await loadChapter(chapterIndex + 1);
      if (destroyed) return;
      await speakFrom(0);
    });
  }

  function handleError(err) {
    if (destroyed) return;
    wantPlaying = false;
    publish({ status: 'paused', error: err.message });
  }

  return {
    async load(newBook, emitFn) {
      book = newBook;
      emit = emitFn;

      // Speed is per book. A book without one starts at 1x: the old global
      // default may hold another book's speed, and the shared router keeps the
      // previous book's rate until it is configured again.
      rate = clampSpeed(book.playbackRate, EPUB_MAX_SPEED);
      router.stop();
      router.configure({ ...loadSettings(), rate });
      router.onChunkStart = handleChunkStart;
      router.onComplete = handleComplete;
      router.onError = handleError;

      emit({ status: 'loading', rate });

      const opened = await open(await readBlob(book));
      if (destroyed) {
        destroyBook(opened.book);
        return;
      }
      epub = opened.book;
      totalChapters = opened.metadata.spineLength;
      chapterList = await listChapters(epub);
      emit({ chapters: chapterList.map((_, i) => ({ title: chapterTitle(i) })) });

      // Fresh book: jump past front matter to the first real content chapter.
      const hasSavedProgress = book.progress?.chapterIndex != null || book.progress?.chunkIndex != null;
      const startChapter = hasSavedProgress ? (book.progress?.chapterIndex ?? 0) : await findFirst(epub);

      await loadChapter(startChapter);
      if (destroyed) return;
      const saved = loadEpubProgress(book.id) ?? book.progress;
      const savedChunk = saved && saved.chapterIndex === chapterIndex ? saved.chunkIndex : 0;
      chunkIndex = Math.min(savedChunk, Math.max(chunks.length - 1, 0));
      publish({ status: 'paused', error: null });
    },

    play() {
      enqueue(async () => {
        if (wantPlaying || !book || !chunks.length) return;
        wantPlaying = true;
        if (router.isPaused()) {
          router.resume();
          // Web Speech reports 'playing' from onChunkStart; the audio element has no such event.
          if (router.aiProvider) publish({ status: 'playing' });
        } else {
          await speakFrom(chunkIndex);
        }
      });
    },

    pause() {
      enqueue(() => {
        wantPlaying = false;
        router.pause();
        publish({ status: 'paused' });
      });
    },

    setRate(newRate) {
      const next = clampSpeed(newRate, EPUB_MAX_SPEED);
      if (next === rate) return;
      rate = next;
      // The router re-speaks the current chunk at the new rate (Web Speech) or
      // sets audio.playbackRate (AI providers). It never writes the saved default.
      router.setRate(rate, { saveAsDefault: false });
      saveBook(book.id, { playbackRate: rate })?.catch?.(err => console.warn('Could not save speed', err));
      publish();
    },

    setSleep(mode) {
      emit({ sleep: sleepTimer.set(mode) });
    },

    skip(seconds) {
      enqueue(async () => {
        if (!chunks.length) return;
        const duration = estimateSecondsRemaining(chunks, 0, rate);
        const perChunk = duration / chunks.length;
        const steps = Math.max(1, Math.round(Math.abs(seconds) / perChunk));
        const target = chunkIndex + (seconds < 0 ? -steps : steps);

        if (target < 0 && chapterIndex > 0) await jumpToChapter(chapterIndex - 1, -1);
        else if (target >= chunks.length && chapterIndex < totalChapters - 1) await jumpToChapter(chapterIndex + 1);
        else await positionAt(target);
      });
    },

    goToChapter(index) {
      enqueue(async () => {
        if (index < 0 || index >= totalChapters) return;
        await jumpToChapter(index);
      });
    },

    seekInChapter(fraction) {
      enqueue(async () => {
        if (!chunks.length) return;
        await positionAt(Math.floor(fraction * chunks.length));
      });
    },

    destroy() {
      destroyed = true;
      wantPlaying = false;
      sleepTimer.destroy();
      router.stop();
      router.onChunkStart = null;
      router.onComplete = null;
      router.onError = null;
      destroyBook(epub);
      epub = null;
    },

    /** Resolves when every queued command has finished (used by tests). */
    async whenIdle() {
      while (tail) await tail;
    },
  };
}
