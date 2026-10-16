import { getCoverBlob } from '../storage/library-db.js';
import { generateFallbackCover } from './cover-fallback.js';

// Cover object URLs by book id. Each is made from a cover Blob read fresh
// from the `files` store (covers are never rewritten, so the URL stays good).
/** @type {Map<string, string>} */
const coverUrlCache = new Map();
/** @type {Map<string, Promise<void>>} */
const pendingCovers = new Map();

/**
 * @typedef {import('../storage/library-db.js').Book} Book
 */

/**
 * The cover URL if it has been loaded already, else null. Draw a placeholder
 * for null and call `ensureCoverUrl` to load it.
 * @param {Book} book
 * @returns {string|null}
 */
export function getBookCoverUrl(book) {
  return coverUrlCache.get(book.id) ?? null;
}

/**
 * Load the book's cover (from the database, or a generated one for books
 * without art) and cache its URL. Resolves once `getBookCoverUrl` works.
 * @param {Book} book
 * @returns {Promise<void>}
 */
export function ensureCoverUrl(book) {
  if (coverUrlCache.has(book.id)) return Promise.resolve();
  let pending = pendingCovers.get(book.id);
  if (!pending) {
    pending = loadCover(book).finally(() => pendingCovers.delete(book.id));
    pendingCovers.set(book.id, pending);
  }
  return pending;
}

/**
 * @param {Book} book
 */
async function loadCover(book) {
  let blob = book.hasCover === false ? undefined : await getCoverBlob(book.id).catch(() => undefined);
  if (!blob) blob = await generateFallbackCover(book.title, book.author);
  coverUrlCache.set(book.id, URL.createObjectURL(blob));
}

/**
 * Format label from the source file extension (MP3, M4B, EPUB, …).
 * @param {Book} book
 * @returns {string}
 */
export function getFormatBadge(book) {
  if (book.type === 'epub') return 'EPUB';
  const ext = (book.sourceFileName ?? '').split('.').pop()?.toLowerCase();
  if (ext && ext.length <= 4 && ext !== book.sourceFileName?.toLowerCase()) {
    return ext.toUpperCase();
  }
  return 'MP3';
}

/**
 * @param {Book} book
 * @param {string} [className='cover-img']
 * @returns {string}
 */
export function renderCoverMarkup(book, className = 'cover-img') {
  const url = getBookCoverUrl(book);
  if (url) {
    return `<img src="${url}" alt="" class="${className}">`;
  }
  return `<div class="cover-placeholder cover-placeholder--loading">${getFormatBadge(book)}</div>`;
}

/**
 * @param {string} bookId
 */
export function revokeCoverUrl(bookId) {
  const url = coverUrlCache.get(bookId);
  if (url) {
    URL.revokeObjectURL(url);
    coverUrlCache.delete(bookId);
  }
}

/**
 * Load cover URLs for a list of books (call after render).
 * @param {Book[]} books
 */
export async function hydrateCoverUrls(books) {
  await Promise.all(books.map((b) => ensureCoverUrl(b)));
}
