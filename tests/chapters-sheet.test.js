import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openChaptersSheet } from '../js/views/chapters-sheet.js';
import { makeStore } from './helpers-store.js';

vi.mock('../js/storage/library-db.js', () => ({
  updateBook: vi.fn(() => Promise.resolve()),
}));

const chapters = [
  { title: 'One', duration: 60 },
  { title: 'Two', duration: 125 },
  { title: 'Three' },
];

function setup(extra = {}) {
  document.body.innerHTML = '<button id="opener">Chapters</button>';
  const t = makeStore();
  t.store.open({ id: 'a', type: 'mp3', title: 'Dune', ...extra });
  t.emit({ status: 'paused', chapters, chapterIndex: 1, chapterElapsed: 30, chapterDuration: 125, trackIndex: 1, trackSeconds: 30 });
  const opener = document.getElementById('opener');
  opener.focus();
  const sheet = openChaptersSheet({ store: t.store, opener });
  return { ...t, sheet, opener };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('chapters sheet', () => {
  it('lists chapters with numbers, durations, a played check and the current one marked', () => {
    setup();
    const rows = [...document.querySelectorAll('.cs-row')];
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('One');
    expect(rows[0].querySelector('.cs-played')).not.toBeNull();
    expect(rows[1].getAttribute('aria-current')).toBe('true');
    expect(rows[1].querySelector('.cs-len').textContent).toBe('2:05');
    expect(rows[1].querySelector('.cs-row-time').textContent).toBe('0:30 of 2:05');
    expect(rows[2].querySelector('.cs-played')).toBeNull();
  });

  it('tapping a chapter goes there and closes the sheet', () => {
    const { engine } = setup();
    document.querySelector('[data-chapter="2"]').click();
    expect(engine.goToChapter).toHaveBeenCalledWith(2);
    expect(document.querySelector('.ns-sheet')).toBeNull();
  });

  it('Escape closes and returns focus to the opener', () => {
    const { opener } = setup();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.ns-sheet')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('bookmarks tab adds, jumps and removes bookmarks', () => {
    const { engine, store } = setup();
    document.querySelector('[data-tab="bookmarks"]').click();
    const add = document.querySelector('[data-action="add"]');
    expect(add.textContent).toContain('Bookmark 0:30 in Two');
    add.click();
    expect(store.getState().book.bookmarks).toHaveLength(1);
    expect(document.querySelectorAll('.cs-bm')).toHaveLength(1);
    expect(document.querySelector('[data-tab="bookmarks"]').textContent).toBe('Bookmarks (1)');

    document.querySelector('[data-jump]').click();
    expect(engine.play).toHaveBeenCalled();
    expect(engine.seekInChapter).toHaveBeenCalledWith(30 / 125);
  });

  it('removes a bookmark', () => {
    const bm = { id: 'x', label: 'Two at 0:10', trackIndex: 1, seconds: 10 };
    setup({ bookmarks: [bm] });
    document.querySelector('[data-tab="bookmarks"]').click();
    document.querySelector('[data-remove="x"]').click();
    expect(document.querySelectorAll('.cs-bm')).toHaveLength(0);
    expect(document.querySelector('.cs-empty').textContent).toBe('No bookmarks yet.');
  });
});
