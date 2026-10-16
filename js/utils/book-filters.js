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
 * Books on one shelf. A shelf shows its finished books too.
 * @param {Book[]} books
 * @param {string} shelfId
 */
export function filterByShelf(books, shelfId) {
  return books.filter((b) => b.shelves?.includes(shelfId));
}

/**
 * Why a filter came up empty: 'finished-only' when "All" has nothing left to
 * listen to but finished books exist (they live under Finished), else 'none'.
 * @param {Book[]} books
 * @param {'all'|'epub'|'mp3'|'finished'} filter
 * @returns {'finished-only'|'none'}
 */
export function emptyKind(books, filter) {
  if (filter === 'all' && filterBooks(books, 'all').length === 0 && books.some((b) => b.finishedAt)) {
    return 'finished-only';
  }
  return 'none';
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

/**
 * Whether a book has actually been listened to. Importing sets lastOpenedAt,
 * so recency alone would put never-opened books in "Continue Listening".
 * @param {object} book
 */
function hasStarted(book) {
  const p = book.progress ?? {};
  return (p.seconds ?? 0) > 0 || (p.trackIndex ?? 0) > 0 || (p.chapterIndex ?? 0) > 0
    || (p.chunkIndex ?? 0) > 0 || (p.percent ?? 0) > 0;
}

/**
 * Short status for a book card: finished, in progress (with percent) or not started.
 * @param {object} book
 * @returns {{ kind: 'finished'|'progress'|'new', percent: number, label: string }}
 */
export function bookStatus(book) {
  if (book.finishedAt) return { kind: 'finished', percent: 100, label: 'Finished' };
  const percent = Math.round(book.progress?.percent ?? 0);
  if (hasStarted(book)) return { kind: 'progress', percent, label: `${percent}%` };
  return { kind: 'new', percent: 0, label: 'Not started' };
}

/**
 * The book for the "Continue Listening" row: the most recently opened book
 * that is started and not finished, or null.
 * @param {object[]} books
 */
export function pickContinueBook(books) {
  return books
    .filter((b) => !b.finishedAt && hasStarted(b))
    .reduce((best, b) => (!best || (b.lastOpenedAt ?? 0) > (best.lastOpenedAt ?? 0) ? b : best), null);
}
