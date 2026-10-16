import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { addBook } from '../js/storage/library-db.js';
import { createShelf, setBookShelves } from '../js/storage/shelves.js';

// jsdom cannot draw the generated fallback covers, so skip loading them.
vi.mock('../js/utils/cover-art.js', async (orig) => ({
  ...(await orig()),
  hydrateCoverUrls: vi.fn(() => Promise.resolve()),
}));

// The library remembers its tab at import time, so load it fresh per test.
async function freshRender() {
  vi.resetModules();
  const { renderLibrary } = await import('../js/views/library.js');
  return renderLibrary(app, callbacks);
}

const callbacks = { onOpenBook: vi.fn(), onOpenSettings: vi.fn() };
let app;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  app = document.getElementById('app');
});

describe('library with shelves', () => {
  it('opens a shelf from the Shelves tab and remembers it', async () => {
    const shelf = createShelf('Bedtime');
    const book = await addBook({ type: 'mp3', title: 'Dune', author: 'FH', tracks: [] });
    await setBookShelves(book.id, [shelf.id]);
    await addBook({ type: 'mp3', title: 'Emma', author: 'JA', tracks: [] });

    await freshRender();
    app.querySelector('.bottom-nav [data-nav="shelves"]').click();
    await vi.waitFor(() => expect(app.querySelector('.library-view').dataset.mode).toBe('shelves'));
    expect(app.querySelector('.bottom-nav [data-nav="shelves"]').getAttribute('aria-current')).toBe('page');
    expect(app.querySelector('.shelf-card-count').textContent).toBe('1 book');

    app.querySelector('.shelf-card[data-shelf-open]').click();
    await vi.waitFor(() => expect(app.querySelector('.library-view').dataset.mode).toBe('shelf'));
    expect(app.querySelector('.books-pane .library-title').textContent).toBe('Bedtime');
    expect(app.querySelectorAll('.books-pane .book-card')).toHaveLength(1);
    expect(localStorage.getItem('library-tab')).toBe(`shelf:${shelf.id}`);
  });

  it('says so when a shelf is empty', async () => {
    const shelf = createShelf('Empty');
    localStorage.setItem('library-tab', `shelf:${shelf.id}`);
    await freshRender();
    expect(app.querySelector('.empty-state').textContent).toMatch(/Shelves…/);
  });

  it('points to Finished when only finished books exist under All', async () => {
    await addBook({ type: 'mp3', title: 'Done', author: 'A', tracks: [], finishedAt: 1 });
    await freshRender();
    expect(app.querySelector('.empty-state').textContent).toMatch(/No unfinished books/);
  });
});
