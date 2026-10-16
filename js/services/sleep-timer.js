/**
 * Sleep timer used by the engines. It only runs the countdown for the timed
 * modes; 'chapter' (stop at the end of the current chapter) is just remembered
 * here and the engine acts on it when the chapter ends.
 */

/** @typedef {'off'|'15'|'30'|'chapter'} SleepMode */
/** @typedef {{ mode: SleepMode, endsAt?: number }} SleepInfo */

const MINUTES = { 15: 15, 30: 30 };

/**
 * @param {{ onExpire: () => void }} options called when a timed mode runs out
 */
export function createSleepTimer({ onExpire }) {
  /** @type {SleepMode} */
  let mode = 'off';
  /** @type {number|undefined} */
  let endsAt;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timeout = null;

  function clear() {
    if (timeout) clearTimeout(timeout);
    timeout = null;
    endsAt = undefined;
  }

  /** @returns {SleepInfo} */
  function info() {
    return endsAt == null ? { mode } : { mode, endsAt };
  }

  return {
    /**
     * Switch mode (replacing any running countdown).
     * @param {SleepMode} next
     * @returns {SleepInfo} what to publish as the store's `sleep`
     */
    set(next) {
      clear();
      mode = MINUTES[next] || next === 'chapter' ? next : 'off';
      if (MINUTES[mode]) {
        const ms = MINUTES[mode] * 60_000;
        endsAt = Date.now() + ms;
        timeout = setTimeout(() => {
          timeout = null;
          mode = 'off';
          endsAt = undefined;
          onExpire();
        }, ms);
      }
      return info();
    },

    /** @returns {SleepMode} */
    getMode: () => mode,

    destroy: clear,
  };
}
