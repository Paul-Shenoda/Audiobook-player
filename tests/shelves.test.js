import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { addBook, getBook } from '../js/storage/library-db.js';
import {
  listShelves,
  createShelf,
  renameShelf,
  deleteShelf,
  setBookShelves,
  shelfSummaries,
} from '../js/storage/shelves.js';

beforeEach(() => {
  localStorage.clear();
});

describe('shelf registry', () => {
  it('starts empty and persists created shelves in order', () => {
    expect(listShelves()).toEqual([]);
    const a = createShelf('  Bedtime ');
    const b = createShelf('Commute');
    expect(a.name).toBe('Bedtime');
    expect(a.id).toBeTruthy();
    expect(typeof a.createdAt).toBe('number');
    expect(listShelves().map((s) => s.name)).toEqual(['Bedtime', 'Commute']);
    expect(JSON.parse(localStorage.getItem('shelves'))).toHaveLength(2);
    expect(b.id).not.toBe(a.id);
  });

  it('rejects empty and case-insensitive duplicate names', () => {
    createShelf('Gothic');
    expect(() => createShelf('   ')).toThrow(/name/i);
    expect(() => createShelf('gothic')).toThrow(/already/i);
    expect(listShelves()).toHaveLength(1);
  });

  it('renames a shelf, allowing a case change of its own name but not a clash', () => {
    const a = createShelf('Gothic');
    createShelf('Commute');
    expect(renameShelf(a.id, 'GOTHIC').name).toBe('GOTHIC');
    expect(() => renameShelf(a.id, 'commute')).toThrow(/already/i);
    expect(() => renameShelf(a.id, ' ')).toThrow(/name/i);
    expect(() => renameShelf('nope', 'X')).toThrow();
    expect(listShelves()[0].name).toBe('GOTHIC');
  });

  it('survives corrupt storage', () => {
    localStorage.setItem('shelves', '{not json');
    expect(listShelves()).toEqual([]);
    localStorage.setItem('shelves', JSON.stringify([{ id: 'x' }, { id: 'y', name: 'Ok', createdAt: 1 }]));
    expect(listShelves().map((s) => s.id)).toEqual(['y']);
  });

  it('still works in memory when localStorage throws', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => listShelves()).not.toThrow();
    const s = createShelf('Temp');
    expect(listShelves().map((x) => x.id)).toContain(s.id);
    get.mockRestore();
    set.mockRestore();
  });
});

describe('books and shelves', () => {
  it('setBookShelves stores ids on the book, de-duplicated, known shelves only', async () => {
    const s1 = createShelf('One');
    const s2 = createShelf('Two');
    const book = await addBook({ type: 'mp3', title: 'T', author: 'A', tracks: [] });
    expect((await getBook(book.id)).shelves).toEqual([]);
    await setBookShelves(book.id, [s1.id, s2.id, s1.id, 'ghost']);
    expect((await getBook(book.id)).shelves).toEqual([s1.id, s2.id]);
    await setBookShelves(book.id, []);
    expect((await getBook(book.id)).shelves).toEqual([]);
  });

  it('deleteShelf removes the id from every book but leaves other shelves', async () => {
    const s1 = createShelf('One');
    const s2 = createShelf('Two');
    const a = await addBook({ type: 'mp3', title: 'A', author: 'x', tracks: [] });
    const b = await addBook({ type: 'mp3', title: 'B', author: 'x', tracks: [] });
    const c = await addBook({ type: 'mp3', title: 'C', author: 'x', tracks: [] });
    await setBookShelves(a.id, [s1.id, s2.id]);
    await setBookShelves(b.id, [s1.id]);
    await deleteShelf(s1.id);
    expect(listShelves().map((s) => s.id)).toEqual([s2.id]);
    expect((await getBook(a.id)).shelves).toEqual([s2.id]);
    expect((await getBook(b.id)).shelves).toEqual([]);
    expect((await getBook(c.id)).shelves).toEqual([]);
  });
});

describe('shelfSummaries', () => {
  it('counts and lists books per shelf, a book on two shelves counts on both', () => {
    const shelves = [
      { id: 's1', name: 'One', createdAt: 1 },
      { id: 's2', name: 'Two', createdAt: 2 },
      { id: 's3', name: 'Empty', createdAt: 3 },
    ];
    const books = [
      { id: 'a', shelves: ['s1', 's2'] },
      { id: 'b', shelves: ['s1'] },
      { id: 'c' },
    ];
    const out = shelfSummaries(shelves, books);
    expect(out.map((o) => o.count)).toEqual([2, 1, 0]);
    expect(out[0].books.map((b) => b.id)).toEqual(['a', 'b']);
    expect(out[2].books).toEqual([]);
    expect(out[1].shelf).toBe(shelves[1]);
  });
});
