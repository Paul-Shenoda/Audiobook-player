import { openDB } from 'idb';

const DB_NAME = 'audiobook-library';
const DB_VERSION = 2;
const BOOKS_STORE = 'books';
// The audio/EPUB/cover Blobs live in their own store, keyed by string (see
// the key helpers below). Safari invalidates a Blob read from IndexedDB when
// the record that holds it is rewritten, and book records are rewritten on
// every progress save, shelf change, etc. A file written once at import and
// never touched again stays readable.
const FILES_STORE = 'files';

/** @param {string} bookId */
export const bookFileKey = (bookId) => `${bookId}:file`;
/** @param {string} bookId */
export const coverKey = (bookId) => `${bookId}:cover`;
/**
 * @param {string} bookId
 * @param {number} index
 */
export const trackFileKey = (bookId, index) => `${bookId}:track:${index}`;

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
 * @property {string} fileKey key of this track's audio Blob in the `files`
 *   store — read it with `getTrackFile`
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
 * @property {boolean} [hasCover] a cover Blob is in the `files` store
 *   (`getCoverBlob`); the EPUB file itself is read with `getBookFile`.
 *   Records never carry Blobs — `addBook` moves them to `files`.
 * @property {string} [sourceFileName] epub only going forward (mp3 moved
 *   this into each track); kept optional for old records
 * @property {number} [sourceFileSize]
 * @property {number} addedAt
 * @property {number} lastOpenedAt
 * @property {number|null} [finishedAt] set when the book is completed
 * @property {SeriesInfo|null} [series]
 * @property {Bookmark[]} [bookmarks] always populated by `normalizeBook`
 * @property {string[]} [shelves] ids of the shelves this book is on (see
 *   `storage/shelves.js`); `normalizeBook` defaults it to []
 * @property {BookProgress} progress
 */

/**
 * Upgrade a book read from IndexedDB to the current shape, in memory only
 * — never rewrites the stored record. Two things need upgrading for books
 * saved before this feature existed: an mp3 book with no `tracks` becomes
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
    shelves: book.shelves ?? [],
  };

  if (book.type === 'mp3' && !book.tracks?.length) {
    normalized.tracks = [
      {
        fileKey: trackFileKey(book.id, 0),
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
 * Move every Blob out of a book record into the `files` store and strip it
 * from the record. Runs inside the version-change transaction, so it is all
 * or nothing. Idempotent: a record with no Blobs is left alone, and files are
 * written under fixed keys, so a re-run just rewrites the same entries.
 * @param {import('idb').IDBPTransaction<unknown, string[], 'versionchange'>} tx
 */
async function moveBlobsToFilesStore(tx) {
  const books = tx.objectStore(BOOKS_STORE);
  const files = tx.objectStore(FILES_STORE);
  let cursor = await books.openCursor();
  while (cursor) {
    const { fileBlob, coverBlob, ...record } = cursor.value;
    let changed = fileBlob !== undefined || coverBlob !== undefined;
    const id = record.id;

    if (coverBlob) {
      await files.put(coverBlob, coverKey(id));
      record.hasCover = true;
    } else if (coverBlob !== undefined) {
      record.hasCover = false;
    }

    let fileUsedAsTrack = false;
    if (record.type === 'mp3' && !record.tracks?.length && fileBlob) {
      // Pre-`tracks` mp3 record: its single file becomes track 0.
      record.tracks = [
        {
          sourceFileName: record.sourceFileName,
          sourceFileSize: record.sourceFileSize,
          label: record.title,
        },
      ];
      await files.put(fileBlob, trackFileKey(id, 0));
      record.tracks[0].fileKey = trackFileKey(id, 0);
      fileUsedAsTrack = true;
    }
    if (fileBlob && !fileUsedAsTrack) {
      await files.put(fileBlob, bookFileKey(id));
    }

    if (record.tracks?.some((t) => t.fileBlob !== undefined)) {
      changed = true;
      record.tracks = [];
      for (const [i, track] of cursor.value.tracks.entries()) {
        const { fileBlob: trackBlob, ...rest } = track;
        if (trackBlob) {
          await files.put(trackBlob, trackFileKey(id, i));
          rest.fileKey = trackFileKey(id, i);
        }
        record.tracks.push(rest);
      }
    }

    if (changed) await cursor.update(record);
    cursor = await cursor.continue();
  }
}

/**
 * @returns {Promise<import('idb').IDBPDatabase>}
 */
/** @type {Promise<import('idb').IDBPDatabase>|null} one shared connection */
let dbPromise = null;
/** The IndexedDB factory `dbPromise` was opened on (tests swap in a fresh one). */
let dbFactory = null;

async function getDb() {
  if (dbFactory !== globalThis.indexedDB) {
    dbFactory = globalThis.indexedDB;
    dbPromise = null;
  }
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    async upgrade(db, oldVersion, _newVersion, tx) {
      if (!db.objectStoreNames.contains(BOOKS_STORE)) {
        const store = db.createObjectStore(BOOKS_STORE, { keyPath: 'id' });
        store.createIndex('lastOpenedAt', 'lastOpenedAt');
        store.createIndex('type', 'type');
      }
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        db.createObjectStore(FILES_STORE);
      }
      if (oldVersion >= 1 && oldVersion < 2) {
        await moveBlobsToFilesStore(tx);
      }
    },
    // A newer version of the app (e.g. after a service-worker update) needs to
    // upgrade the database: let go of this connection so the upgrade isn't blocked.
    blocking() {
      dbPromise?.then((db) => db.close());
      dbPromise = null;
    },
    terminated() {
      dbPromise = null;
    },
  });
  return dbPromise;
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
 * Add a book. The caller passes the Blobs on the data (`fileBlob` for an
 * EPUB, `coverBlob`, and `fileBlob` on each track); they are written to the
 * `files` store in the same transaction and the stored record keeps only
 * references to them.
 * @param {Omit<Book, 'id'|'addedAt'|'lastOpenedAt'|'progress'|'hasCover'> & {
 *   progress?: BookProgress,
 *   fileBlob?: Blob,
 *   coverBlob?: Blob|null,
 *   tracks?: Array<Omit<AudioTrack, 'fileKey'> & { fileBlob: Blob }>,
 * }} data
 * @returns {Promise<Book>}
 */
export async function addBook(data) {
  const db = await getDb();
  const { fileBlob, coverBlob, tracks, ...rest } = data;
  const id = crypto.randomUUID();
  const book = {
    ...rest,
    id,
    hasCover: Boolean(coverBlob),
    addedAt: Date.now(),
    lastOpenedAt: Date.now(),
    progress: data.progress ?? {},
  };
  const trackBlobs = [];
  if (tracks) {
    book.tracks = tracks.map(({ fileBlob: trackBlob, ...track }, i) => {
      trackBlobs.push(trackBlob);
      return { ...track, fileKey: trackFileKey(id, i) };
    });
  }

  const tx = db.transaction([BOOKS_STORE, FILES_STORE], 'readwrite');
  const files = tx.objectStore(FILES_STORE);
  if (fileBlob) files.put(fileBlob, bookFileKey(id));
  if (coverBlob) files.put(coverBlob, coverKey(id));
  trackBlobs.forEach((blob, i) => {
    if (blob) files.put(blob, trackFileKey(id, i));
  });
  tx.objectStore(BOOKS_STORE).put(book);
  await tx.done;
  return book;
}

/**
 * Update a book's metadata. Only the `books` store is written — the files
 * are never touched, so Blobs read earlier stay valid.
 * @param {string} id
 * @param {Partial<Book>} updates
 */
export async function updateBook(id, updates) {
  const db = await getDb();
  // Read and write in ONE readwrite transaction. IndexedDB queues overlapping
  // readwrite transactions on a store, so each update sees the previous one's
  // result; separate get/put calls let a progress save overwrite a speed change.
  const tx = db.transaction(BOOKS_STORE, 'readwrite');
  const existing = await tx.store.get(id);
  if (!existing) {
    await tx.done;
    return;
  }
  // Blobs never belong on the record (see FILES_STORE), even if a caller passes one.
  const metadata = { ...updates };
  delete metadata.fileBlob;
  delete metadata.coverBlob;
  const updated = { ...normalizeBook(existing), ...metadata, id };
  await tx.store.put(updated);
  await tx.done;
  return updated;
}

/**
 * Remove a book and all of its files.
 * @param {string} id
 */
export async function deleteBook(id) {
  const db = await getDb();
  const tx = db.transaction([BOOKS_STORE, FILES_STORE], 'readwrite');
  tx.objectStore(BOOKS_STORE).delete(id);
  tx.objectStore(FILES_STORE).delete(IDBKeyRange.bound(`${id}:`, `${id}:\uffff`));
  await tx.done;
}

/**
 * @returns {Promise<Book|null>}
 */
export async function getMostRecentBook() {
  const books = await getAllBooks();
  return books[0] ?? null;
}

/**
 * Read a stored file fresh. Always call this right before using the Blob and
 * don't hold the result across other work: a new read is the only thing
 * Safari guarantees valid.
 * @param {string} key
 * @returns {Promise<Blob|undefined>}
 */
async function getFile(key) {
  const db = await getDb();
  return db.get(FILES_STORE, key);
}

/**
 * The EPUB file of an epub book.
 * @param {string} bookId
 * @returns {Promise<Blob|undefined>}
 */
export function getBookFile(bookId) {
  return getFile(bookFileKey(bookId));
}

/**
 * @param {string} bookId
 * @returns {Promise<Blob|undefined>}
 */
export function getCoverBlob(bookId) {
  return getFile(coverKey(bookId));
}

/**
 * One audio file of an mp3-type book.
 * @param {string} bookId
 * @param {string} [trackKey] the track's `fileKey`; defaults to `trackFileKey(bookId, 0)`
 * @returns {Promise<Blob|undefined>}
 */
export function getTrackFile(bookId, trackKey = trackFileKey(bookId, 0)) {
  return getFile(trackKey);
}
