// @vitest-environment node
// (fake-indexeddb can only clone Blobs that are Node's own, not jsdom's.)
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  addBook,
  getBook,
  getAllBooks,
  updateBook,
  deleteBook,
  getBookFile,
  getCoverBlob,
  getTrackFile,
} from '../js/storage/library-db.js';

const text = (blob) => blob.text();

/** Open the raw database to inspect what is really stored. */
const rawDb = () => openDB('audiobook-library');

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('files store', () => {
  it('addBook writes the blobs to files and keeps only references on the record', async () => {
    const book = await addBook({
      type: 'mp3',
      title: 'T',
      author: 'A',
      coverBlob: new Blob(['cover']),
      tracks: [
        { fileBlob: new Blob(['one']), sourceFileName: 'a.mp3', sourceFileSize: 3 },
        { fileBlob: new Blob(['two']), sourceFileName: 'b.mp3', sourceFileSize: 3 },
      ],
    });

    const db = await rawDb();
    const stored = await db.get('books', book.id);
    db.close();
    expect(stored.coverBlob).toBeUndefined();
    expect(stored.hasCover).toBe(true);
    expect(stored.tracks.every((t) => t.fileBlob === undefined)).toBe(true);

    expect(await text(await getCoverBlob(book.id))).toBe('cover');
    expect(await text(await getTrackFile(book.id, stored.tracks[0].fileKey))).toBe('one');
    expect(await text(await getTrackFile(book.id, stored.tracks[1].fileKey))).toBe('two');
  });

  it('stores an EPUB file and a book without a cover', async () => {
    const book = await addBook({
      type: 'epub',
      title: 'E',
      author: 'A',
      fileBlob: new Blob(['epub']),
      coverBlob: null,
      sourceFileName: 'e.epub',
      sourceFileSize: 4,
    });
    expect(book.hasCover).toBe(false);
    expect(await text(await getBookFile(book.id))).toBe('epub');
    expect(await getCoverBlob(book.id)).toBeUndefined();
  });

  it('updateBook never writes the files store and files stay readable afterwards', async () => {
    const book = await addBook({
      type: 'epub',
      title: 'E',
      author: 'A',
      fileBlob: new Blob(['epub']),
      coverBlob: new Blob(['cover']),
    });
    const db = await rawDb();
    const before = await db.get('files', `${book.id}:file`);
    db.close();

    await updateBook(book.id, { shelves: ['s1'] });
    await updateBook(book.id, { progress: { chapterIndex: 2, chunkIndex: 1, percent: 5 } });
    // A caller passing a blob must not put it on the record either.
    await updateBook(book.id, { coverBlob: new Blob(['other']) });

    const db2 = await rawDb();
    const record = await db2.get('books', book.id);
    const after = await db2.get('files', `${book.id}:file`);
    db2.close();
    expect(record.coverBlob).toBeUndefined();
    expect(record.fileBlob).toBeUndefined();
    expect(before).toBeDefined();
    expect(await text(after)).toBe('epub');
    expect(await text(await getBookFile(book.id))).toBe('epub');
    expect(await text(await getCoverBlob(book.id))).toBe('cover');
    expect((await getBook(book.id)).shelves).toEqual(['s1']);
  });

  it('deleteBook removes the record and all of its files, and only its own', async () => {
    const a = await addBook({
      type: 'mp3',
      title: 'A',
      author: 'A',
      coverBlob: new Blob(['ca']),
      tracks: [{ fileBlob: new Blob(['ta']), sourceFileName: 'a.mp3', sourceFileSize: 2 }],
    });
    const b = await addBook({
      type: 'epub',
      title: 'B',
      author: 'B',
      fileBlob: new Blob(['fb']),
      coverBlob: new Blob(['cb']),
    });

    await deleteBook(a.id);

    const db = await rawDb();
    expect(await db.get('books', a.id)).toBeUndefined();
    expect(await db.getAllKeys('files')).toEqual([`${b.id}:cover`, `${b.id}:file`].sort());
    db.close();
    expect((await getAllBooks()).map((x) => x.id)).toEqual([b.id]);
  });
});

describe('migration from version 1', () => {
  /** Create a version-1 database the way the old app did, then close it. */
  async function seedV1(records) {
    const db = await openDB('audiobook-library', 1, {
      upgrade(d) {
        const store = d.createObjectStore('books', { keyPath: 'id' });
        store.createIndex('lastOpenedAt', 'lastOpenedAt');
        store.createIndex('type', 'type');
      },
    });
    for (const r of records) await db.put('books', r);
    db.close();
  }

  const base = { author: 'A', addedAt: 1, lastOpenedAt: 1, progress: {} };

  it('moves epub, cover, multi-track and legacy single-file blobs out of the records', async () => {
    await seedV1([
      { ...base, id: 'e', type: 'epub', title: 'E', fileBlob: new Blob(['epub']), coverBlob: new Blob(['ce']), sourceFileName: 'e.epub', sourceFileSize: 4 },
      {
        ...base,
        id: 'm',
        type: 'mp3',
        title: 'M',
        coverBlob: null,
        tracks: [
          { fileBlob: new Blob(['t0']), sourceFileName: 'a.mp3', sourceFileSize: 2, label: 'One' },
          { fileBlob: new Blob(['t1']), sourceFileName: 'b.mp3', sourceFileSize: 2, label: 'Two' },
        ],
      },
      { ...base, id: 'l', type: 'mp3', title: 'L', fileBlob: new Blob(['legacy']), coverBlob: new Blob(['cl']), sourceFileName: 'l.mp3', sourceFileSize: 6 },
    ]);

    const books = await getAllBooks();
    const byId = Object.fromEntries(books.map((b) => [b.id, b]));

    const db = await rawDb();
    for (const id of ['e', 'm', 'l']) {
      const stored = await db.get('books', id);
      expect(stored.fileBlob).toBeUndefined();
      expect(stored.coverBlob).toBeUndefined();
      expect((stored.tracks ?? []).every((t) => t.fileBlob === undefined)).toBe(true);
    }
    db.close();

    expect(await text(await getBookFile('e'))).toBe('epub');
    expect(await text(await getCoverBlob('e'))).toBe('ce');
    expect(byId.e.hasCover).toBe(true);

    expect(byId.m.hasCover).toBe(false);
    expect(byId.m.tracks.map((t) => t.label)).toEqual(['One', 'Two']);
    expect(await text(await getTrackFile('m', byId.m.tracks[1].fileKey))).toBe('t1');

    expect(byId.l.tracks).toHaveLength(1);
    expect(byId.l.tracks[0]).toMatchObject({ sourceFileName: 'l.mp3', sourceFileSize: 6, label: 'L' });
    expect(await text(await getTrackFile('l', byId.l.tracks[0].fileKey))).toBe('legacy');
    expect(await text(await getCoverBlob('l'))).toBe('cl');
  });

  it('keeps metadata and a fresh database upgrades cleanly', async () => {
    await seedV1([{ ...base, id: 'x', type: 'epub', title: 'X', fileBlob: new Blob(['f']), shelves: ['s'], bookmarks: [{ id: 'b' }], finishedAt: 5 }]);
    const book = await getBook('x');
    expect(book).toMatchObject({ title: 'X', shelves: ['s'], finishedAt: 5 });
    expect(book.bookmarks).toHaveLength(1);

    globalThis.indexedDB = new IDBFactory();
    expect(await getAllBooks()).toEqual([]);
  });
});
