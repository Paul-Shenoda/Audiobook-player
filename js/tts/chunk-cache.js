import { openDB } from 'idb';

const DB_NAME = 'audiobook-tts-cache';
const STORE = 'audio-chunks';

/**
 * @returns {Promise<import('idb').IDBPDatabase>}
 */
async function getDb() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE);
        store.createIndex('bookId', 'bookId');
      }
    },
  });
}

/**
 * @param {string} bookId
 * @param {number} chapterIndex
 * @param {number} chunkIndex
 * @param {string} voiceId
 * @param {string} providerId
 */
export function cacheKey(bookId, chapterIndex, chunkIndex, voiceId, providerId) {
  return `${bookId}:${chapterIndex}:${chunkIndex}:${providerId}:${voiceId}`;
}

/**
 * @param {string} key
 * @returns {Promise<Blob|null>}
 */
export async function getCachedAudio(key) {
  const db = await getDb();
  const entry = await db.get(STORE, key);
  return entry?.blob ?? null;
}

/**
 * @param {string} key
 * @param {Blob} blob
 * @param {string} bookId
 */
export async function setCachedAudio(key, blob, bookId) {
  const db = await getDb();
  await db.put(STORE, { blob, bookId, cachedAt: Date.now() }, key);
}

/**
 * @param {string} bookId
 */
export async function clearBookCache(bookId) {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  const index = tx.store.index('bookId');
  let cursor = await index.openCursor(bookId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}
