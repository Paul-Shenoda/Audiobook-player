import { openDB } from 'idb';

const DB_NAME = 'audiobook-library';
const BOOKS_STORE = 'books';

/**
 * @typedef {Object} BookProgress
 * @property {number} [seconds] mp3 only — seconds within the current track
 * @property {number} [trackIndex] mp3 only — which track `seconds` applies to
 * @property {number} [chapterIndex] epub only
 * @property {number} [chunkIndex] epub only
 * @property {number} [percent] both types — overall book completion, 0-100
 */

/**
 * A chapter marker inside a single audio file (e.g. an M4B's embedded
 * QuickTime chapter track) — distinct from `AudioTrack`, which is a whole
 * separate file. Best-effort only: most M4B chapter data is unreadable in
 * the browser (see `readM4bChapters` in import-service.js), so a track's
 * `chapters` is usually absent even for a chaptered book.
 * @typedef {Object} FileChapter
 * @property {string} title
 * @property {number} startSeconds
 */

/**
 * One playable file within an mp3-type Book. A normal single-file audiobook
 * has exactly one; a chapter-per-file audiobook combined via the "combine
 * into one audiobook" import action has one per chapter, in play order.
 * @typedef {Object} AudioTrack
 * @property {Blob} fileBlob
 * @property {string} sourceFileName the dedup key, checked per-track
 * @property {number} sourceFileSize
 * @property {string} [label] shown in the chapter/track picker — falls back
 *   to "Track N" if absent
 * @property {FileChapter[]} [chapters] only meaningful when this is a book's
 *   sole track — in-file chapter markers, shown/navigated the same way as
 *   `AudioTrack`-per-chapter books but without reloading `player.src`
 */

/**
 * A manually-saved, named position the user can jump back to — distinct
 * from the automatic resume position in `progress`. Exactly one of
 * (trackIndex+seconds) [mp3] or (chapterIndex+chunkIndex) [epub] is set,
 * matching whichever the book's `type` is.
 * @typedef {Object} Bookmark
 * @property {string} id
 * @property {string} label
 * @property {number} createdAt
 * @property {number} [trackIndex]
 * @property {number} [seconds]
 * @property {number} [chapterIndex]
 * @property {number} [chunkIndex]
 */

/**
 * @typedef {Object} SeriesInfo
 * @property {string} name
 * @property {number} [position] e.g. 2 for "Book 2"; fractional (2.5) for
 *   novellas/side-stories is fine
 */

/**
 * @typedef {Object} Book
 * @property {string} id
 * @property {'mp3'|'epub'} type
 * @property {string} title
 * @property {string} author
 * @property {AudioTrack[]} [tracks] mp3 only — always populated by the time
 *   a caller sees it (see `normalizeBook`), even for books stored before
 *   this field existed
 * @property {Blob} [fileBlob] epub only going forward; retained on old mp3
 *   records purely as the source `normalizeBook` migrates from — never read
 *   directly for an mp3 book, use `tracks` instead
 * @property {Blob|null} [coverBlob]
 * @property {string} [sourceFileName] epub only going forward (mp3 moved
 *   this into each track); kept optional for old records
 * @property {number} [sourceFileSize]
 * @property {number} addedAt
 * @property {number} lastOpenedAt
 * @property {number|null} [finishedAt] set when the book is completed
 * @property {SeriesInfo|null} [series]
 * @property {Bookmark[]} [bookmarks] always populated by `normalizeBook`
 * @property {BookProgress} progress
 */

/**
 * Upgrade a book read from IndexedDB to the current shape, in memory only
 * — never rewrites the stored record. Two things need upgrading for books
 * saved before this feature existed: an mp3 book's single `fileBlob` becomes
 * a one-entry `tracks` array, and `bookmarks`/`series` default in. This is
 * the same "migrate on read, never touch old data until it's next saved"
 * pattern `js/tts/tts-router.js`'s `migrateSettings` uses.
 * @param {Book} book
 * @returns {Book}
 */
export function normalizeBook(book) {
  const normalized = {
    ...book,
    series: book.series ?? null,
    bookmarks: book.bookmarks ?? [],
  };

  if (book.type === 'mp3' && !book.tracks?.length) {
    normalized.tracks = [
      {
        fileBlob: book.fileBlob,
        sourceFileName: book.sourceFileName,
        sourceFileSize: book.sourceFileSize,
        label: book.title,
      },
    ];
  }

  if (book.type === 'mp3' && normalized.progress?.trackIndex == null) {
    normalized.progress = { ...normalized.progress, trackIndex: 0 };
  }

  return normalized;
}

/**
 * @returns {Promise<import('idb').IDBPDatabase>}
 */
async function getDb() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(BOOKS_STORE)) {
        const store = db.createObjectStore(BOOKS_STORE, { keyPath: 'id' });
        store.createIndex('lastOpenedAt', 'lastOpenedAt');
        store.createIndex('type', 'type');
      }
    },
  });
}

/**
 * @returns {Promise<Book[]>}
 */
export async function getAllBooks() {
  const db = await getDb();
  const books = await db.getAll(BOOKS_STORE);
  return books.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).map(normalizeBook);
}

/**
 * @param {string} id
 * @returns {Promise<Book|undefined>}
 */
export async function getBook(id) {
  const db = await getDb();
  const book = await db.get(BOOKS_STORE, id);
  return book ? normalizeBook(book) : undefined;
}

/**
 * @param {Omit<Book, 'id'|'addedAt'|'lastOpenedAt'|'progress'> & { progress?: BookProgress }} data
 * @returns {Promise<Book>}
 */
export async function addBook(data) {
  const db = await getDb();
  const book = {
    ...data,
    id: crypto.randomUUID(),
    addedAt: Date.now(),
    lastOpenedAt: Date.now(),
    progress: data.progress ?? {},
  };
  await db.put(BOOKS_STORE, book);
  return book;
}

/**
 * @param {string} id
 * @param {Partial<Book>} updates
 */
export async function updateBook(id, updates) {
  const db = await getDb();
  const existing = await db.get(BOOKS_STORE, id);
  if (!existing) return;
  const updated = { ...normalizeBook(existing), ...updates, id };
  await db.put(BOOKS_STORE, updated);
  return updated;
}

/**
 * @param {string} id
 */
export async function deleteBook(id) {
  const db = await getDb();
  await db.delete(BOOKS_STORE, id);
}

/**
 * @returns {Promise<Book|null>}
 */
export async function getMostRecentBook() {
  const books = await getAllBooks();
  return books[0] ?? null;
}

/**
 * @param {Book} book
 * @returns {string|null}
 */
export function getCoverObjectUrl(book) {
  if (!book.coverBlob) return null;
  return URL.createObjectURL(book.coverBlob);
}
