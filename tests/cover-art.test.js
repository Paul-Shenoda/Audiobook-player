// @vitest-environment node
// (fake-indexeddb can only clone Blobs that are Node's own, not jsdom's.)
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/utils/cover-fallback.js', () => ({
  generateFallbackCover: vi.fn(async () => new Blob(['generated'])),
}));

import { addBook, updateBook } from '../js/storage/library-db.js';
import { getBookCoverUrl, ensureCoverUrl, revokeCoverUrl } from '../js/utils/cover-art.js';
import { generateFallbackCover } from '../js/utils/cover-fallback.js';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:cover-${(n += 1)}`);
  URL.revokeObjectURL = vi.fn();
});

describe('cover art', () => {
  it('has no URL until loaded, then makes one from the files store', async () => {
    const book = await addBook({ type: 'epub', title: 'T', author: 'A', fileBlob: new Blob(['f']), coverBlob: new Blob(['cover']) });
    expect(getBookCoverUrl(book)).toBeNull();

    await ensureCoverUrl(book);

    expect(getBookCoverUrl(book)).toBe('blob:cover-1');
    expect(await URL.createObjectURL.mock.calls[0][0].text()).toBe('cover');
    expect(generateFallbackCover).not.toHaveBeenCalled();
  });

  it('shares one load between concurrent callers and survives later book updates', async () => {
    const book = await addBook({ type: 'epub', title: 'T', author: 'A', fileBlob: new Blob(['f']), coverBlob: new Blob(['cover']) });
    await Promise.all([ensureCoverUrl(book), ensureCoverUrl(book)]);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    await updateBook(book.id, { shelves: ['s'] });
    expect(getBookCoverUrl(book)).toBe('blob:cover-1');
  });

  it('generates a cover for a book without one, and revoke clears it', async () => {
    const book = await addBook({ type: 'epub', title: 'No Art', author: 'A', fileBlob: new Blob(['f']), coverBlob: null });
    await ensureCoverUrl(book);
    expect(generateFallbackCover).toHaveBeenCalledWith('No Art', 'A');
    expect(getBookCoverUrl(book)).not.toBeNull();
    revokeCoverUrl(book.id);
    expect(getBookCoverUrl(book)).toBeNull();
  });
});
