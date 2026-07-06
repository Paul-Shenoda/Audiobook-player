/**
 * Sleep timer for the players. Modes cycle in order; 'chapter' (stop at the
 * end of the current chapter) only applies to the EPUB player.
 */

/** @typedef {'off'|'15'|'30'|'60'|'chapter'} SleepMode */

const MINUTES = { 15: 15, 30: 30, 60: 60 };

/**
 * @param {{
 *   modes: SleepMode[],
 *   onExpire: () => void,
 *   onTick: (label: string) => void,
 * }} options modes is the cycle order, starting with 'off'
 */
export function createSleepTimer({ modes, onExpire, onTick }) {
  /** @type {SleepMode} */
  let mode = 'off';
  /** @type {number|null} */
  let deadline = null;
  /** @type {ReturnType<typeof setInterval>|null} */
  let interval = null;

  function label() {
    if (mode === 'off') return 'Sleep: Off';
    if (mode === 'chapter') return 'Sleep: End of chapter';
    if (deadline == null) return `Sleep: ${mode} min`;
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const m = Math.floor(remaining / 60);
    const s = String(remaining % 60).padStart(2, '0');
    return `Sleep: ${m}:${s}`;
  }

  function clearCountdown() {
    if (interval) clearInterval(interval);
    interval = null;
    deadline = null;
  }

  function startCountdown(minutes) {
    deadline = Date.now() + minutes * 60_000;
    interval = setInterval(() => {
      if (deadline != null && Date.now() >= deadline) {
        clearCountdown();
        mode = 'off';
        onTick(label());
        onExpire();
        return;
      }
      onTick(label());
    }, 1000);
  }

  return {
    /** Advance to the next mode in the cycle. */
    cycle() {
      clearCountdown();
      mode = modes[(modes.indexOf(mode) + 1) % modes.length];
      if (MINUTES[mode]) startCountdown(MINUTES[mode]);
      onTick(label());
    },

    /** @returns {SleepMode} */
    getMode() {
      return mode;
    },

    /** Reset to off (e.g. after an end-of-chapter stop). */
    reset() {
      clearCountdown();
      mode = 'off';
      onTick(label());
    },

    destroy() {
      clearCountdown();
    },

    label,
  };
}
