import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderNowPlaying } from '../js/views/now-playing.js';
import { makeStore } from './helpers-store.js';

vi.mock('../js/storage/library-db.js', () => ({
  getCoverBlob: () => Promise.resolve(new Blob(['x'])),
  updateBook: vi.fn(() => Promise.resolve()),
}));

const audioBook = { id: 'a', type: 'mp3', title: 'Dune', author: 'Herbert', hasCover: true };
const epubBook = { id: 'e', type: 'epub', title: 'Emma', author: 'Austen', hasCover: true };
const chapters = [{ title: 'One', duration: 100 }, { title: 'Two', duration: 200 }, { title: 'Three', duration: 300 }];

function mount(book = audioBook) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const t = makeStore();
  const callbacks = { onClose: vi.fn(), onOpenSettings: vi.fn(), store: t.store };
  const view = renderNowPlaying(container, book, callbacks);
  t.emit({ status: 'paused', chapters, chapterIndex: 1, chapterElapsed: 50, chapterDuration: 200, bookPercent: 20, rate: 1 });
  const q = sel => container.querySelector(sel);
  return { ...t, container, q, view, ...callbacks };
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:cover');
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('renderNowPlaying', () => {
  it('gives the title its full text as a title attribute and flags long titles', () => {
    const long = 'Age of Bronze: A LitRPG Dungeon Core Adventure (Rise of Mankind Book 2)';
    const { q } = mount({ ...audioBook, title: long });
    expect(q('.np-title').getAttribute('title')).toBe(long);
    expect(q('.np-title').classList.contains('np-title--long')).toBe(true);
    const short = mount();
    expect(short.q('.np-title').classList.contains('np-title--long')).toBe(false);
  });

  it('opens the book in the store and shows chapter, times and book progress', () => {
    const { store, q } = mount();
    expect(store.getState().book.id).toBe('a');
    expect(q('#np-chapter').textContent).toBe('Chapter 2 of 3');
    expect(q('#np-elapsed').textContent).toBe('0:50');
    expect(q('#np-remaining').textContent).toBe('−2:30');
    expect(q('#np-book-text').textContent).toBe('20% of book, about 8 min left');
  });

  it('play button mirrors the store status and calls toggle', () => {
    const { q, emit, engine } = mount();
    expect(q('#np-play').getAttribute('aria-label')).toBe('Play');
    q('#np-play').click();
    expect(engine.play).toHaveBeenCalled();
    emit({ status: 'playing' });
    expect(q('#np-play').getAttribute('aria-label')).toBe('Pause');
    q('#np-play').click();
    expect(engine.pause).toHaveBeenCalled();
    emit({ status: 'loading' });
    expect(q('#np-play').getAttribute('aria-label')).toBe('Play');
  });

  it('transport buttons send skip and chapter commands', () => {
    const { q, engine } = mount();
    q('#np-back').click();
    q('#np-forward').click();
    q('#np-prev').click();
    q('#np-next').click();
    expect(engine.skip.mock.calls).toEqual([[-15], [30]]);
    expect(engine.goToChapter.mock.calls).toEqual([[0], [2]]);
  });

  it('scrubber keys seek within the chapter', () => {
    const { q, engine } = mount();
    q('#np-scrub').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(engine.seekInChapter).toHaveBeenCalledWith(60 / 200);
    expect(q('#np-scrub').getAttribute('role')).toBe('slider');
  });

  it('speed sheet lists the steps, highlights the current one and sets the rate', () => {
    const { q, engine, emit } = mount();
    emit({ rate: 1.5 });
    q('#np-speed').click();
    const options = [...document.querySelectorAll('.sp-option')].map(b => b.textContent);
    expect(options).toContain('3×');
    expect(document.querySelector('.sp-option--current').textContent).toBe('1.5×');
    document.querySelector('[data-rate="2"]').click();
    expect(engine.setRate).toHaveBeenCalledWith(2);
    expect(document.querySelector('.ns-sheet')).toBeNull();
  });

  it('caps EPUB speeds at 2x and offers read along only for EPUBs', () => {
    const e = mount(epubBook);
    e.q('#np-speed').click();
    const options = [...document.querySelectorAll('.sp-option')].map(b => b.textContent);
    expect(options).not.toContain('2.5×');
    expect(options).toContain('2×');
    expect(e.q('#np-readalong-btn').hidden).toBe(false);
    document.body.innerHTML = '';
    const a = mount(audioBook);
    expect(a.q('#np-readalong-btn').hidden).toBe(true);
  });

  it('sleep tile cycles off, 15, 30, end of chapter', () => {
    const { q, engine, emit } = mount();
    q('#np-sleep').click();
    expect(engine.setSleep).toHaveBeenLastCalledWith('15');
    emit({ sleep: { mode: '15', endsAt: 1 } });
    expect(q('#np-sleep').classList.contains('np-tile--on')).toBe(true);
    q('#np-sleep').click();
    expect(engine.setSleep).toHaveBeenLastCalledWith('30');
    emit({ sleep: { mode: 'chapter' } });
    q('#np-sleep').click();
    expect(engine.setSleep).toHaveBeenLastCalledWith('off');
  });

  it('chapters tile opens the sheet; close button and view close behave', () => {
    const { q, onClose } = mount();
    q('#np-chapters').click();
    expect(document.querySelector('.cs-sheet')).not.toBeNull();
    q('#np-close').click();
    expect(onClose).toHaveBeenCalled();
  });

  it('read along shows chunks, highlights the current one, tap seeks and plays', () => {
    const { q, emit, engine, container } = mount(epubBook);
    emit({ readAlong: { chunks: ['aa', 'bb', 'cc', 'dd'], chunkIndex: 1 } });
    q('#np-readalong-btn').click();
    expect(q('#np-readalong').hidden).toBe(false);
    expect(container.querySelector('.np-chunk--current').textContent.trim()).toBe('bb');
    container.querySelector('[data-chunk="2"]').click();
    expect(engine.seekInChapter).toHaveBeenCalledWith(2.5 / 4);
    expect(engine.play).toHaveBeenCalled();
  });

  it('more menu offers narration settings for EPUBs', () => {
    const { q, onOpenSettings } = mount(epubBook);
    q('#np-more').click();
    document.querySelector('[data-menu="settings"]').click();
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('cleanup stops following the store and leaves playback alone', () => {
    const { view, q, emit, engine } = mount();
    view.cleanup();
    emit({ status: 'playing' });
    expect(q('#np-play').getAttribute('aria-label')).toBe('Play');
    expect(engine.pause).not.toHaveBeenCalled();
  });
});
