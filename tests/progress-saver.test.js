import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProgressSaver } from '../js/services/progress-saver.js';

describe('createProgressSaver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps saving during continuous playback (timeupdate every 250 ms)', () => {
    // Regression: a 2 s debounce on timeupdate never fired while audio played,
    // so closing the app mid-listen lost the position.
    const save = vi.fn();
    const saver = createProgressSaver({ save, intervalMs: 5000 });

    for (let elapsed = 0; elapsed < 12000; elapsed += 250) {
      saver.tick();
      vi.advanceTimersByTime(250);
    }

    expect(save.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('saves at most once per interval', () => {
    const save = vi.fn();
    const saver = createProgressSaver({ save, intervalMs: 5000 });

    for (let elapsed = 0; elapsed < 4000; elapsed += 250) {
      saver.tick();
      vi.advanceTimersByTime(250);
    }

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush() saves immediately, even right after a tick', () => {
    const save = vi.fn();
    const saver = createProgressSaver({ save, intervalMs: 5000 });

    saver.tick();
    saver.flush();

    expect(save).toHaveBeenCalledTimes(2);
  });

  it('does not save after dispose()', () => {
    const save = vi.fn();
    const saver = createProgressSaver({ save, intervalMs: 5000 });

    saver.dispose();
    saver.tick();
    saver.flush();
    vi.advanceTimersByTime(10000);

    expect(save).not.toHaveBeenCalled();
  });
});
