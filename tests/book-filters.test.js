import { describe, it, expect } from 'vitest';
import { filterBooks, searchBooks, sortBooks, pickContinueBook, bookStatus } from '../js/utils/book-filters.js';

const books = [
  { id: '1', type: 'mp3', title: 'Dune', author: 'Frank Herbert' },
  { id: '2', type: 'epub', title: 'Emma', author: 'Jane Austen', finishedAt: 123 },
  { id: '3', type: 'epub', title: 'Persuasion', author: 'Jane Austen' },
];

describe('filterBooks with finished shelf', () => {
  it('excludes finished books from all/type filters', () => {
    expect(filterBooks(books, 'all').map((b) => b.id)).toEqual(['1', '3']);
    expect(filterBooks(books, 'epub').map((b) => b.id)).toEqual(['3']);
    expect(filterBooks(books, 'mp3').map((b) => b.id)).toEqual(['1']);
  });

  it('shows only finished books under the finished filter', () => {
    expect(filterBooks(books, 'finished').map((b) => b.id)).toEqual(['2']);
  });
});

describe('searchBooks', () => {
  it('matches title or author, case-insensitive', () => {
    expect(searchBooks(books, 'dune').map((b) => b.id)).toEqual(['1']);
    expect(searchBooks(books, 'austen').map((b) => b.id)).toEqual(['2', '3']);
  });

  it('returns all books for empty query', () => {
    expect(searchBooks(books, '  ')).toHaveLength(3);
  });
});

describe('sortBooks', () => {
  it('sorts by title', () => {
    expect(sortBooks(books, 'title').map((b) => b.title)).toEqual(['Dune', 'Emma', 'Persuasion']);
  });

  it('keeps original order for recent', () => {
    expect(sortBooks(books, 'recent').map((b) => b.id)).toEqual(['1', '2', '3']);
  });
});

describe('pickContinueBook', () => {
  const book = (id, extra) => ({ id, title: id, lastOpenedAt: 0, finishedAt: null, progress: {}, ...extra });

  it('skips books that were imported but never started', () => {
    // Regression: import sets lastOpenedAt, so a just-imported EPUB at 0% was shown.
    const books = [
      book('imported', { lastOpenedAt: 300, type: 'epub', progress: {} }),
      book('listened', { lastOpenedAt: 200, type: 'mp3', progress: { trackIndex: 0, seconds: 42, percent: 12 } }),
    ];
    expect(pickContinueBook(books)?.id).toBe('listened');
  });

  it('picks the most recently opened started book', () => {
    const books = [
      book('older', { lastOpenedAt: 100, progress: { trackIndex: 0, seconds: 10 } }),
      book('newer', { lastOpenedAt: 500, progress: { chapterIndex: 2, chunkIndex: 0 } }),
    ];
    expect(pickContinueBook(books)?.id).toBe('newer');
  });

  it('counts a later track or chapter at second 0 as started', () => {
    expect(pickContinueBook([book('a', { progress: { trackIndex: 3, seconds: 0 } })])?.id).toBe('a');
    expect(pickContinueBook([book('b', { progress: { chapterIndex: 0, chunkIndex: 5 } })])?.id).toBe('b');
  });

  it('skips finished books', () => {
    const books = [book('done', { lastOpenedAt: 900, finishedAt: 950, progress: { seconds: 99, percent: 100 } })];
    expect(pickContinueBook(books)).toBeNull();
  });

  it('returns null for an empty library or missing progress', () => {
    expect(pickContinueBook([])).toBeNull();
    expect(pickContinueBook([{ id: 'x', lastOpenedAt: 1 }])).toBeNull();
  });
});

describe('bookStatus', () => {
  it('reports finished, in progress (with percent) and not started', () => {
    expect(bookStatus({ finishedAt: 5 })).toEqual({ kind: 'finished', percent: 100, label: 'Finished' });
    expect(bookStatus({ progress: { percent: 42 } })).toEqual({ kind: 'progress', percent: 42, label: '42%' });
    expect(bookStatus({})).toEqual({ kind: 'new', percent: 0, label: 'Not started' });
    expect(bookStatus({ progress: { percent: 0, seconds: 30 } }).kind).toBe('progress');
  });
});
