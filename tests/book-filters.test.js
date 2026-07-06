import { describe, it, expect } from 'vitest';
import { filterBooks, searchBooks, sortBooks } from '../js/utils/book-filters.js';

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
