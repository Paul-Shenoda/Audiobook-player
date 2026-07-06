import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ePubMock } = vi.hoisted(() => ({ ePubMock: vi.fn() }));
vi.mock('epubjs', () => ({ default: ePubMock }));

import { openEpub } from '../js/epub/epub-loader.js';

function makeBook(overrides = {}) {
  const listeners = new Map();
  return {
    on(event, cb) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(cb);
    },
    emit(event, arg) {
      (listeners.get(event) ?? []).forEach((cb) => cb(arg));
    },
    ready: Promise.resolve(),
    loaded: {
      metadata: Promise.resolve({ title: 'Test Book', creator: 'Author' }),
      packaging: Promise.resolve({ manifest: {} }),
    },
    coverUrl: async () => null,
    spine: { length: 3 },
    destroy: vi.fn(),
    ...overrides,
  };
}

describe('openEpub input handling', () => {
  beforeEach(() => {
    ePubMock.mockReset();
  });

  it('passes the raw ArrayBuffer to epubjs (never a blob URL string)', async () => {
    // Regression: epubjs sniffs string inputs by extension, so an
    // extensionless blob URL is treated as a directory and never opens.
    ePubMock.mockReturnValue(makeBook());
    const buffer = new ArrayBuffer(8);

    await openEpub(buffer);

    expect(ePubMock).toHaveBeenCalledTimes(1);
    expect(ePubMock).toHaveBeenCalledWith(buffer);
  });

  it('converts File/Blob sources to an ArrayBuffer before opening', async () => {
    ePubMock.mockReturnValue(makeBook());
    // jsdom's Blob lacks arrayBuffer(), so stub the File shape openEpub uses.
    const file = { arrayBuffer: async () => new ArrayBuffer(16) };

    await openEpub(file);

    const arg = ePubMock.mock.calls[0][0];
    expect(typeof arg).not.toBe('string');
    expect(arg).toBeInstanceOf(ArrayBuffer);
  });

  it('reads title, author and spine length from the opened book', async () => {
    ePubMock.mockReturnValue(makeBook());

    const { metadata } = await openEpub(new ArrayBuffer(8));

    expect(metadata.title).toBe('Test Book');
    expect(metadata.author).toBe('Author');
    expect(metadata.spineLength).toBe(3);
  });

  it('rejects and destroys the book when epubjs emits openFailed', async () => {
    // Regression: epubjs only emits "openFailed" on bad input — book.ready
    // never settles — so without the listener the import hangs forever.
    const book = makeBook({ ready: new Promise(() => {}) });
    ePubMock.mockReturnValue(book);

    const opening = openEpub(new ArrayBuffer(8));
    book.emit('openFailed', new Error('bad zip'));

    await expect(opening).rejects.toThrow('bad zip');
    expect(book.destroy).toHaveBeenCalled();
  });
});
