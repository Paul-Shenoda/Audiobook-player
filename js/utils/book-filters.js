/**
 * Pure library filtering/sorting helpers.
 * @typedef {import('../storage/library-db.js').Book} Book
 */

/**
 * Finished books live only under the 'finished' filter; every other filter
 * shows unfinished books.
 * @param {Book[]} books
 * @param {'all'|'epub'|'mp3'|'finished'} filter
 */
export function filterBooks(books, filter) {
  if (filter === 'finished') return books.filter((b) => b.finishedAt);
  const unfinished = books.filter((b) => !b.finishedAt);
  if (filter === 'all') return unfinished;
  return unfinished.filter((b) => b.type === filter);
}

/**
 * @param {Book[]} books
 * @param {string} query
 */
export function searchBooks(books, query) {
  const q = query.trim().toLowerCase();
  if (!q) return books;
  return books.filter(
    (b) =>
      b.title.toLowerCase().includes(q) ||
      b.author.toLowerCase().includes(q),
  );
}

/**
 * @param {Book[]} books
 * @param {'recent'|'title'|'author'} sort
 */
export function sortBooks(books, sort) {
  const copy = [...books];
  if (sort === 'title') {
    copy.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sort === 'author') {
    copy.sort((a, b) => a.author.localeCompare(b.author) || a.title.localeCompare(b.title));
  }
  // 'recent': getAllBooks already returns lastOpenedAt desc
  return copy;
}
