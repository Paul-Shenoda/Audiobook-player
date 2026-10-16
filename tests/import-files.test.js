// @vitest-environment node
// (fake-indexeddb can only clone Blobs that are Node's own, not jsdom's.)
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('jsmediatags', () => ({
  default: { read: (_file, cb) => cb.onError() },
}));
vi.mock('music-metadata', () => ({ parseBlob: vi.fn() }));
vi.mock('../js/utils/cover-fallback.js', () => ({
  generateFallbackCover: vi.fn(async () => new Blob(['generated cover'])),
}));

import { importBooks, importCombinedAudiobook } from '../js/services/import-service.js';
import { getAllBooks, getCoverBlob, getTrackFile } from '../js/storage/library-db.js';

const audio = (name, body) => Object.assign(new Blob([body]), { name });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('import writes files to the files store', () => {
  it('stores a single audio file and its cover, and skips the same file again', async () => {
    const file = audio('book.mp3', 'audio-bytes');
    const first = await importBooks([file]);
    expect(first.added).toHaveLength(1);

    const [book] = await getAllBooks();
    expect(book.tracks[0].fileBlob).toBeUndefined();
    expect(await (await getTrackFile(book.id, book.tracks[0].fileKey)).text()).toBe('audio-bytes');
    expect(await (await getCoverBlob(book.id)).text()).toBe('generated cover');

    const second = await importBooks([file]);
    expect(second.added).toHaveLength(0);
    expect(second.skipped).toHaveLength(1);
  });

  it('stores every file of a combined audiobook under its own track key', async () => {
    const book = await importCombinedAudiobook([audio('1.mp3', 'one'), audio('2.mp3', 'two')]);
    expect(book.tracks.map((t) => t.sourceFileName)).toEqual(['1.mp3', '2.mp3']);
    expect(await (await getTrackFile(book.id, book.tracks[0].fileKey)).text()).toBe('one');
    expect(await (await getTrackFile(book.id, book.tracks[1].fileKey)).text()).toBe('two');
  });
});
