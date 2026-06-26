import { getCoverObjectUrl } from '../storage/library-db.js';
import { generateFallbackCover } from './cover-fallback.js';

/** @type {Map<string, string>} */
const fallbackUrlCache = new Map();

/**
 * @typedef {import('../storage/library-db.js').Book} Book
 */

/**
 * @param {Book} book
 * @returns {string|null}
 */
export function getBookCoverUrl(book) {
  if (book.coverBlob) {
    return getCoverObjectUrl(book);
  }
  return fallbackUrlCache.get(book.id) ?? null;
}

/**
 * Ensure fallback cover URL is cached for books without embedded art.
 * @param {Book} book
 */
export async function ensureFallbackCoverUrl(book) {
  if (book.coverBlob || fallbackUrlCache.has(book.id)) return;
  const blob = await generateFallbackCover(book.title, book.author);
  fallbackUrlCache.set(book.id, URL.createObjectURL(blob));
}

/**
 * @param {Book} book
 * @param {string} [className='cover-img']
 * @returns {string}
 */
export function renderCoverMarkup(book, className = 'cover-img') {
  const url = getBookCoverUrl(book);
  const badge = book.type === 'mp3' ? 'MP3' : 'EPUB';
  if (url) {
    return `<img src="${url}" alt="" class="${className}">`;
  }
  return `<div class="cover-placeholder cover-placeholder--loading">${badge}</div>`;
}

/**
 * @param {string} bookId
 */
export function revokeFallbackCoverUrl(bookId) {
  const url = fallbackUrlCache.get(bookId);
  if (url) {
    URL.revokeObjectURL(url);
    fallbackUrlCache.delete(bookId);
  }
}

/**
 * Hydrate fallback URLs for a list of books (call after render).
 * @param {Book[]} books
 */
export async function hydrateCoverUrls(books) {
  await Promise.all(
    books
      .filter((b) => !b.coverBlob)
      .map((b) => ensureFallbackCoverUrl(b)),
  );
}
