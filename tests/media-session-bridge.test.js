import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bridgeMediaSession } from '../js/services/media-session-bridge.js';
import { makeStore } from './helpers-store.js';

vi.mock('../js/storage/library-db.js', () => ({ getCoverBlob: () => Promise.resolve(new Blob(['x'])) }));

function fakeSession() {
  const handlers = {};
  return {
    handlers,
    metadata: null,
    playbackState: 'none',
    setPositionState: vi.fn(),
    setActionHandler: vi.fn((action, fn) => {
      handlers[action] = fn;
    }),
  };
}

beforeEach(() => {
  globalThis.MediaMetadata = class {
    constructor(init) {
      Object.assign(this, init);
    }
  };
});

describe('bridgeMediaSession', () => {
  it('does nothing without a media session', () => {
    const { store } = makeStore();
    expect(() => bridgeMediaSession(store, { mediaSession: undefined })()).not.toThrow();
  });

  it('sets metadata, playback state and position from the store', () => {
    const ms = fakeSession();
    const { store, emit } = makeStore();
    bridgeMediaSession(store, { mediaSession: ms });
    store.open({ id: 'a', type: 'mp3', title: 'Dune', author: 'Herbert' });
    expect(ms.metadata).toMatchObject({ title: 'Dune', artist: 'Herbert' });
    expect(ms.playbackState).toBe('paused');
    emit({ status: 'playing', chapterElapsed: 10, chapterDuration: 100, rate: 1.5 });
    expect(ms.playbackState).toBe('playing');
    expect(ms.setPositionState).toHaveBeenLastCalledWith({ duration: 100, position: 10, playbackRate: 1.5 });
    emit({ status: 'paused' });
    expect(ms.playbackState).toBe('paused');
    store.close();
    expect(ms.playbackState).toBe('none');
    expect(ms.metadata).toBeNull();
  });

  it('maps lock-screen actions to store commands', () => {
    const ms = fakeSession();
    const { store, engine, emit } = makeStore();
    bridgeMediaSession(store, { mediaSession: ms });
    store.open({ id: 'a', type: 'mp3', title: 'Dune' });
    emit({ chapters: [{ title: 'a' }, { title: 'b' }, { title: 'c' }], chapterIndex: 1, chapterDuration: 200 });
    ms.handlers.play();
    ms.handlers.pause();
    ms.handlers.seekbackward();
    ms.handlers.seekforward();
    ms.handlers.previoustrack();
    ms.handlers.nexttrack();
    ms.handlers.seekto({ seekTime: 50 });
    expect(engine.play).toHaveBeenCalled();
    expect(engine.pause).toHaveBeenCalled();
    expect(engine.skip.mock.calls).toEqual([[-15], [30]]);
    expect(engine.goToChapter.mock.calls).toEqual([[0], [2]]);
    expect(engine.seekInChapter).toHaveBeenCalledWith(0.25);
  });

  it('stop unsubscribes and clears handlers', () => {
    const ms = fakeSession();
    const { store, emit } = makeStore();
    const stop = bridgeMediaSession(store, { mediaSession: ms });
    store.open({ id: 'a', type: 'mp3', title: 'Dune' });
    stop();
    emit({ status: 'playing' });
    expect(ms.playbackState).toBe('paused');
    expect(ms.handlers.play).toBeNull();
  });
});
