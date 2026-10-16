import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPlayerStore } from '../js/services/player-store.js';
import { mountMiniPlayer } from '../js/views/mini-player.js';

function makeStore() {
  let emit;
  const engine = {
    load: vi.fn((book, e) => {
      emit = e;
    }),
    play: vi.fn(),
    pause: vi.fn(),
    setRate: vi.fn(),
    skip: vi.fn(),
    goToChapter: vi.fn(),
    seekInChapter: vi.fn(),
    destroy: vi.fn(),
  };
  const store = createPlayerStore({ createEngine: () => engine });
  return { store, engine, emit: partial => emit(partial) };
}

const book = { id: 'a', type: 'mp3', title: 'Dune', author: 'Herbert' };

describe('mountMiniPlayer', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
  });

  it('is hidden with no book, shows the book once opened', () => {
    const { store } = makeStore();
    mountMiniPlayer(container, { store, onOpenBook: () => {} });
    expect(container.innerHTML).toBe('');
    store.open(book);
    expect(container.classList.contains('mini-player-bar--visible')).toBe(true);
    expect(container.querySelector('.mini-title').textContent).toBe('Dune');
    expect(container.querySelector('.mini-sub').textContent).toBe('Audiobook');
  });

  it('follows the store status: playing shows Pause, paused shows Play', () => {
    const { store, emit } = makeStore();
    mountMiniPlayer(container, { store, onOpenBook: () => {} });
    store.open(book);
    emit({ status: 'playing' });
    expect(container.querySelector('#mini-play').getAttribute('aria-label')).toBe('Pause');
    emit({ status: 'paused' });
    expect(container.querySelector('#mini-play').getAttribute('aria-label')).toBe('Play');
  });

  it('two subscribers stay in sync', () => {
    const { store, emit } = makeStore();
    const other = document.createElement('div');
    mountMiniPlayer(container, { store, onOpenBook: () => {} });
    mountMiniPlayer(other, { store, onOpenBook: () => {} });
    store.open(book);
    emit({ status: 'playing' });
    emit({ status: 'paused' });
    for (const el of [container, other]) {
      expect(el.querySelector('#mini-play').getAttribute('aria-label')).toBe('Play');
    }
  });

  it('the play button toggles through the store, not by flipping its own icon', () => {
    const { store, engine, emit } = makeStore();
    mountMiniPlayer(container, { store, onOpenBook: () => {} });
    store.open(book);
    emit({ status: 'paused' });
    container.querySelector('#mini-play').click();
    expect(engine.play).toHaveBeenCalled();
    expect(container.querySelector('#mini-play').getAttribute('aria-label')).toBe('Play');
  });

  it('opens the book on tap and stops rendering after unmount', () => {
    const { store, emit } = makeStore();
    const onOpenBook = vi.fn();
    const unmount = mountMiniPlayer(container, { store, onOpenBook });
    store.open(book);
    container.querySelector('#mini-open').click();
    expect(onOpenBook).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    unmount();
    emit({ status: 'playing' });
    expect(container.innerHTML).toBe('');
  });
});
