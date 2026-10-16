import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSleepTimer } from '../js/services/sleep-timer.js';

afterEach(() => vi.useRealTimers());

describe('createSleepTimer', () => {
  it('timed modes report an end time and call onExpire once', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const timer = createSleepTimer({ onExpire });
    const info = timer.set('30');
    expect(info).toEqual({ mode: '30', endsAt: Date.now() + 30 * 60_000 });
    vi.advanceTimersByTime(30 * 60_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(timer.getMode()).toBe('off');
  });

  it('chapter mode has no countdown and off cancels', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const timer = createSleepTimer({ onExpire });
    expect(timer.set('chapter')).toEqual({ mode: 'chapter' });
    timer.set('15');
    expect(timer.set('off')).toEqual({ mode: 'off' });
    vi.advanceTimersByTime(60 * 60_000);
    expect(onExpire).not.toHaveBeenCalled();
  });
});
