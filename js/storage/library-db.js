import { openDB } from 'idb';

const DB_NAME = 'audiobook-library';
const BOOKS_STORE = 'books';

/**
 * @typedef {Object} BookProgress
 * @property {number} [seconds]
 * @property {number} [chapterIndex]
 * @property {number} [chunkIndex]
 * @property {number} [percent]
 */

/**
 * @typedef {Object} Book
 * @property {string} id
 * @property {'mp3'|'epub'} type
 * @property {string} title
 * @property {string} author
 * @property {Blob} fileBlob
 * @property {Blob|null} [coverBlob]
 * @property {string} [sourceFileName]
 * @property {number} [sourceFileSize]
 * @property {number} addedAt
 * @property {number} lastOpenedAt
 * @property {BookProgress} progress
 */

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
  return books.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

/**
 * @param {string} id
 * @returns {Promise<Book|undefined>}
 */
export async function getBook(id) {
  const db = await getDb();
  return db.get(BOOKS_STORE, id);
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
  const updated = { ...existing, ...updates, id };
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
