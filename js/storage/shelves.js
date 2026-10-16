import { getAllBooks, updateBook } from './library-db.js';

/**
 * Shelves are tags. The registry (id, name, createdAt) lives in localStorage;
 * each Book carries `shelves: string[]` of shelf ids, so a book can sit on
 * more than one shelf.
 *
 * @typedef {Object} Shelf
 * @property {string} id
 * @property {string} name
 * @property {number} createdAt
 */

const KEY = 'shelves';

/** Used only when localStorage is unavailable, so the app still works for the session. @type {Shelf[]|null} */
let memoryFallback = null;

/** @returns {Shelf[]} */
function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string');
  } catch {
    return memoryFallback ?? [];
  }
}

/** @param {Shelf[]} list */
function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    memoryFallback = null;
  } catch {
    memoryFallback = list;
  }
}

/**
 * Trim and check a name against the other shelves, case-insensitively.
 * @param {string} name
 * @param {Shelf[]} others
 */
function cleanName(name, others) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) throw new Error('Enter a shelf name.');
  if (others.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error('A shelf with that name already exists.');
  }
  return trimmed;
}

/** @returns {Shelf[]} */
export function listShelves() {
  return read();
}

/**
 * @param {string} name
 * @returns {Shelf}
 */
export function createShelf(name) {
  const list = read();
  const shelf = { id: crypto.randomUUID(), name: cleanName(name, list), createdAt: Date.now() };
  write([...list, shelf]);
  return shelf;
}

/**
 * @param {string} id
 * @param {string} name
 * @returns {Shelf}
 */
export function renameShelf(id, name) {
  const list = read();
  const shelf = list.find((s) => s.id === id);
  if (!shelf) throw new Error('That shelf no longer exists.');
  const renamed = { ...shelf, name: cleanName(name, list.filter((s) => s.id !== id)) };
  write(list.map((s) => (s.id === id ? renamed : s)));
  return renamed;
}

/**
 * Remove the shelf and take its id off every book. The books stay in the library.
 * @param {string} id
 */
export async function deleteShelf(id) {
  write(read().filter((s) => s.id !== id));
  const books = await getAllBooks();
  await Promise.all(
    books
      .filter((b) => b.shelves?.includes(id))
      .map((b) => updateBook(b.id, { shelves: b.shelves.filter((s) => s !== id) })),
  );
}

/**
 * Replace the set of shelves a book is on. Unknown ids are dropped.
 * @param {string} bookId
 * @param {string[]} ids
 */
export async function setBookShelves(bookId, ids) {
  const known = new Set(read().map((s) => s.id));
  const shelves = [...new Set(ids)].filter((id) => known.has(id));
  await updateBook(bookId, { shelves });
}

/**
 * Pure: for each shelf, the books on it and how many.
 * @param {Shelf[]} shelves
 * @param {{ id: string, shelves?: string[] }[]} books
 * @returns {{ shelf: Shelf, count: number, books: typeof books }[]}
 */
export function shelfSummaries(shelves, books) {
  return shelves.map((shelf) => {
    const onShelf = books.filter((b) => b.shelves?.includes(shelf.id));
    return { shelf, count: onShelf.length, books: onShelf };
  });
}
