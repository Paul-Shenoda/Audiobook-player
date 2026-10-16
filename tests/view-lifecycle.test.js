import { describe, it, expect, vi } from 'vitest';
import { createViewLifecycle } from '../js/services/view-lifecycle.js';

describe('createViewLifecycle', () => {
  it('fully cleans up a backgrounded player when the next book opens', () => {
    // Regression: Back cleaned up with keepPlayback and forgot the view, so
    // opening the next book never ran its full cleanup (leaked savers/listeners).
    const clearPlayback = vi.fn();
    const life = createViewLifecycle({ clearPlayback });
    const playerA = vi.fn();

    life.show(playerA);
    life.leave({ keepPlayback: true }); // Back to the library, audio keeps playing
    life.leave({ keepPlayback: false }); // open book B

    expect(playerA.mock.calls).toEqual([[{ keepPlayback: true }], [{ keepPlayback: false }]]);
    expect(clearPlayback).toHaveBeenCalledTimes(1);
  });

  it('runs a full cleanup straight away when leaving without keeping playback', () => {
    const life = createViewLifecycle({ clearPlayback: vi.fn() });
    const view = vi.fn();

    life.show(view);
    life.leave({ keepPlayback: false });

    expect(view.mock.calls).toEqual([[{ keepPlayback: false }]]);
  });

  it('does not run a full cleanup twice', () => {
    const life = createViewLifecycle({ clearPlayback: vi.fn() });
    const view = vi.fn();

    life.show(view);
    life.leave({ keepPlayback: true });
    life.leave({ keepPlayback: false });
    life.leave({ keepPlayback: false });

    expect(view).toHaveBeenCalledTimes(2);
  });

  it('library -> settings -> library keeps the backgrounded player alive', () => {
    const life = createViewLifecycle({ clearPlayback: vi.fn() });
    const player = vi.fn();

    life.show(player);
    life.leave({ keepPlayback: true }); // library
    life.leave({ keepPlayback: true }); // settings
    life.leave({ keepPlayback: true }); // library again

    expect(player.mock.calls).toEqual([[{ keepPlayback: true }]]);
  });

  it('knows which book is on screen, and forgets it when leaving', () => {
    // Tapping the mini player for the book already on screen must not rebuild
    // it (rebuilding the EPUB reader hit Safari's stale-Blob error).
    const life = createViewLifecycle({ clearPlayback: vi.fn() });

    life.show(vi.fn(), 'book-1');
    expect(life.isShowing('book-1')).toBe(true);
    expect(life.isShowing('book-2')).toBe(false);

    life.leave({ keepPlayback: true }); // back to the library
    expect(life.isShowing('book-1')).toBe(false);
  });
});
