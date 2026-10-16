import { describe, it, expect, vi } from 'vitest';
import { createPlayerStore } from '../js/services/player-store.js';

/** A fake engine that records calls and lets a test emit state by hand. */
function makeFakeEngine() {
  const engine = {
    emit: null,
    book: null,
    load: vi.fn((book, emit) => {
      engine.book = book;
      engine.emit = emit;
    }),
    play: vi.fn(),
    pause: vi.fn(),
    setRate: vi.fn(),
    skip: vi.fn(),
    goToChapter: vi.fn(),
    seekInChapter: vi.fn(),
    destroy: vi.fn(),
  };
  return engine;
}

function setup() {
  const engines = [];
  const createEngine = vi.fn(() => {
    const engine = makeFakeEngine();
    engines.push(engine);
    return engine;
  });
  const store = createPlayerStore({ createEngine });
  return { store, engines, createEngine };
}

const mp3Book = { id: 'a', type: 'mp3', title: 'A' };
const epubBook = { id: 'b', type: 'epub', title: 'B' };

describe('createPlayerStore', () => {
  it('starts idle with no book', () => {
    const { store } = setup();
    expect(store.getState()).toMatchObject({ book: null, kind: null, status: 'idle', chapterIndex: 0 });
  });

  it('calls every subscriber with the full state after each change', () => {
    const { store, engines } = setup();
    const a = vi.fn();
    const b = vi.fn();
    store.subscribe(a);
    store.subscribe(b);

    store.open(mp3Book);
    engines[0].emit({ status: 'playing' });

    expect(a).toHaveBeenLastCalledWith(expect.objectContaining({ book: mp3Book, status: 'playing' }));
    expect(b).toHaveBeenLastCalledWith(a.mock.calls.at(-1)[0]);
  });

  it('stops calling a subscriber after it unsubscribes', () => {
    const { store, engines } = setup();
    const a = vi.fn();
    const b = vi.fn();
    const unsubscribeA = store.subscribe(a);
    store.subscribe(b);
    store.open(mp3Book);
    unsubscribeA();
    a.mockClear();

    engines[0].emit({ status: 'playing' });

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });

  it('merges emitted partial state into the existing state', () => {
    const { store, engines } = setup();
    store.open(mp3Book);
    engines[0].emit({ status: 'playing', chapterIndex: 2 });
    engines[0].emit({ chapterElapsed: 12 });

    expect(store.getState()).toMatchObject({ status: 'playing', chapterIndex: 2, chapterElapsed: 12 });
  });

  it('picks the engine by book type and loads the book into it', () => {
    const { store, createEngine, engines } = setup();
    store.open(mp3Book);
    store.open(epubBook);

    expect(createEngine.mock.calls.map(c => c[0])).toEqual(['audio', 'epub']);
    expect(engines[0].load).toHaveBeenCalledWith(mp3Book, expect.any(Function));
    expect(store.getState().kind).toBe('epub');
  });

  it('sets status only from engine emits, never from commands', () => {
    const { store, engines } = setup();
    store.open(mp3Book);
    engines[0].emit({ status: 'paused' });

    store.play();
    expect(engines[0].play).toHaveBeenCalled();
    expect(store.getState().status).toBe('paused');

    engines[0].emit({ status: 'playing' });
    store.pause();
    expect(engines[0].pause).toHaveBeenCalled();
    expect(store.getState().status).toBe('playing');
  });

  it('toggle pauses when playing and plays otherwise', () => {
    const { store, engines } = setup();
    store.open(mp3Book);
    engines[0].emit({ status: 'playing' });
    store.toggle();
    expect(engines[0].pause).toHaveBeenCalledTimes(1);
    expect(engines[0].play).not.toHaveBeenCalled();

    engines[0].emit({ status: 'paused' });
    store.toggle();
    expect(engines[0].play).toHaveBeenCalledTimes(1);
  });

  it('opening the book that is already loaded does nothing', () => {
    const { store, createEngine, engines } = setup();
    store.open(mp3Book);
    store.open({ ...mp3Book });

    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(engines[0].destroy).not.toHaveBeenCalled();
  });

  it('destroys the previous engine before opening a different book', () => {
    const { store, engines } = setup();
    store.open(mp3Book);
    store.open(epubBook);

    expect(engines[0].destroy).toHaveBeenCalledTimes(1);
    expect(engines[1].destroy).not.toHaveBeenCalled();
    expect(store.getState().book).toBe(epubBook);
  });

  it('ignores emits from a destroyed engine', () => {
    const { store, engines } = setup();
    store.open(mp3Book);
    store.open(epubBook);
    engines[0].emit({ status: 'playing' });

    expect(store.getState().status).not.toBe('playing');
  });

  it('forwards setRate, skip, chapter and seek commands to the engine', () => {
    const { store, engines } = setup();
    store.open(mp3Book);
    engines[0].emit({ chapterIndex: 1, chapters: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] });

    store.setRate(1.5);
    store.skip(-15);
    store.nextChapter();
    store.prevChapter();
    store.goToChapter(0);
    store.seekInChapter(0.5);

    expect(engines[0].setRate).toHaveBeenCalledWith(1.5);
    expect(engines[0].skip).toHaveBeenCalledWith(-15);
    expect(engines[0].goToChapter.mock.calls).toEqual([[2], [0], [0]]);
    expect(engines[0].seekInChapter).toHaveBeenCalledWith(0.5);
  });

  it('does not go past the first or last chapter', () => {
    const { store, engines } = setup();
    store.open(mp3Book);
    engines[0].emit({ chapterIndex: 0, chapters: [{ title: 'a' }, { title: 'b' }] });
    store.prevChapter();
    expect(engines[0].goToChapter).not.toHaveBeenCalled();

    engines[0].emit({ chapterIndex: 1 });
    store.nextChapter();
    expect(engines[0].goToChapter).not.toHaveBeenCalled();
  });

  it('commands do nothing when no book is open', () => {
    const { store } = setup();
    expect(() => {
      store.play();
      store.pause();
      store.toggle();
      store.setRate(2);
      store.skip(5);
      store.nextChapter();
      store.seekInChapter(0.1);
      store.stop();
    }).not.toThrow();
  });

  it('stop pauses without closing the book', () => {
    const { store, engines } = setup();
    store.open(mp3Book);
    store.stop();

    expect(engines[0].pause).toHaveBeenCalled();
    expect(store.getState().book).toBe(mp3Book);
  });

  it('close destroys the engine and resets the state', () => {
    const { store, engines } = setup();
    const listener = vi.fn();
    store.open(mp3Book);
    engines[0].emit({ status: 'playing', rate: 1.5, chapterIndex: 3 });
    store.subscribe(listener);

    store.close();

    expect(engines[0].destroy).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ book: null, kind: null, status: 'idle', rate: 1, chapterIndex: 0 });
    expect(listener).toHaveBeenCalled();
  });

  it('reports an error status when the engine fails to load', () => {
    const store = createPlayerStore({
      createEngine: () => ({
        load: () => {
          throw new Error('boom');
        },
        destroy: vi.fn(),
      }),
    });
    store.open(mp3Book);
    expect(store.getState()).toMatchObject({ status: 'error', error: 'boom' });
  });

  it('throws a clear error if no engine factory was set', () => {
    const store = createPlayerStore();
    expect(() => store.open(mp3Book)).toThrow(/engine factory/i);
    store.setEngineFactory(() => makeFakeEngine());
    expect(() => store.open(mp3Book)).not.toThrow();
  });
});
