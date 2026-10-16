import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { addBook, getBook, updateBook } from '../js/storage/library-db.js';

describe('updateBook', () => {
  it('does not lose an update when two updates overlap', async () => {
    // Regression: updateBook read, then wrote in separate steps, so a progress
    // save racing a speed change could write back the old speed.
    const book = await addBook({ type: 'mp3', title: 'T', author: 'A', tracks: [] });

    await Promise.all([
      updateBook(book.id, { playbackRate: 1.25 }),
      updateBook(book.id, { progress: { trackIndex: 0, seconds: 42, percent: 10 } }),
    ]);

    const saved = await getBook(book.id);
    expect(saved.playbackRate).toBe(1.25);
    expect(saved.progress.seconds).toBe(42);
  });

  it('applies rapid successive updates in order (last one wins)', async () => {
    const book = await addBook({ type: 'mp3', title: 'T2', author: 'A', tracks: [] });

    await Promise.all([1.5, 1.75, 2, 1.75, 1.5, 1.25].map((rate) => updateBook(book.id, { playbackRate: rate })));

    expect((await getBook(book.id)).playbackRate).toBe(1.25);
  });
});
