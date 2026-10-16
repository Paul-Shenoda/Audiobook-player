/**
 * Tracks the on-screen view's cleanup, and the backgrounded player's.
 *
 * Going back to the library keeps playback running (mini player), so that
 * player only gets a partial cleanup. It is remembered here and fully cleaned
 * up when playback really stops (another book opens). Previously main.js
 * forgot it after the partial cleanup, leaking its progress saver, page
 * listeners, sleep timer and media session for the rest of the session.
 *
 * @param {{ clearPlayback: () => void }} options
 */
export function createViewLifecycle({ clearPlayback }) {
  /** @type {((o: { keepPlayback: boolean }) => void) | null} */
  let onScreen = null;
  /** @type {((o: { keepPlayback: boolean }) => void) | null} */
  let backgrounded = null;

  return {
    /** @param {(o: { keepPlayback: boolean }) => void} cleanup */
    show(cleanup) {
      onScreen = cleanup;
    },

    /** @param {{ keepPlayback?: boolean }} [options] */
    leave({ keepPlayback = false } = {}) {
      if (keepPlayback) {
        if (onScreen) {
          onScreen({ keepPlayback: true });
          backgrounded = onScreen;
          onScreen = null;
        }
        return;
      }
      for (const cleanup of new Set([onScreen, backgrounded])) {
        if (cleanup) cleanup({ keepPlayback: false });
      }
      onScreen = null;
      backgrounded = null;
      clearPlayback();
    },
  };
}
