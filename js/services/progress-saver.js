/**
 * Saves playback progress at a steady pace while audio plays.
 *
 * A throttle, not a debounce: `timeupdate` fires ~4×/s during playback, so a
 * "save 2 s after the last event" debounce never fired until playback stopped,
 * and closing the app mid-listen lost the position. tick() saves at most once
 * per interval; flush() saves now (pause, seek, track change, app hidden).
 *
 * @param {{ save: () => void, intervalMs?: number, now?: () => number }} options
 */
export function createProgressSaver({ save, intervalMs = 5000, now = Date.now }) {
  let lastSavedAt = -Infinity;
  let disposed = false;

  function flush() {
    if (disposed) return;
    lastSavedAt = now();
    save();
  }

  return {
    tick() {
      if (!disposed && now() - lastSavedAt >= intervalMs) flush();
    },
    flush,
    dispose() {
      disposed = true;
    },
  };
}
