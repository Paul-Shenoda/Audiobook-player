import { getBookCoverUrl } from '../utils/cover-art.js';

const SEEK_BACK_S = 15;
const SEEK_FORWARD_S = 30;
const ACTIONS = ['play', 'pause', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack', 'seekto'];

/**
 * Wire the lock screen / notification controls to the player store, once for
 * the whole app. Metadata follows the book, playbackState follows the engine's
 * status, and the handlers send the same commands the buttons do.
 * Does nothing where the Media Session API is missing.
 *
 * @param {ReturnType<typeof import('./player-store.js').createPlayerStore>} store
 * @param {{ mediaSession?: MediaSession|undefined }} [deps] injectable for tests
 * @returns {() => void} stop
 */
export function bridgeMediaSession(store, { mediaSession = globalThis.navigator?.mediaSession } = {}) {
  if (!mediaSession) return () => {};

  const setHandler = (action, fn) => {
    try {
      mediaSession.setActionHandler(action, fn);
    } catch {
      // This browser doesn't know the action.
    }
  };

  const handlers = {
    play: () => store.play(),
    pause: () => store.pause(),
    seekbackward: () => store.skip(-SEEK_BACK_S),
    seekforward: () => store.skip(SEEK_FORWARD_S),
    previoustrack: () => store.prevChapter(),
    nexttrack: () => store.nextChapter(),
    seekto: details => {
      const { chapterDuration } = store.getState();
      if (details?.seekTime != null && chapterDuration > 0) {
        // The lock-screen scrubber shows the current chapter.
        store.seekInChapter(details.seekTime / chapterDuration);
      }
    },
  };
  for (const action of ACTIONS) setHandler(action, handlers[action]);

  let bookId = null;
  const stop = store.subscribe(s => {
    if (s.book?.id !== bookId) {
      bookId = s.book?.id ?? null;
      const coverUrl = s.book ? getBookCoverUrl(s.book) : null;
      mediaSession.metadata = s.book
        ? new MediaMetadata({
            title: s.book.title,
            artist: s.book.author,
            album: 'Audiobook Library',
            artwork: coverUrl ? [{ src: coverUrl, sizes: '512x512', type: s.book.coverBlob?.type || 'image/png' }] : [],
          })
        : null;
    }
    mediaSession.playbackState = !s.book ? 'none' : s.status === 'playing' ? 'playing' : 'paused';

    if (s.book && s.chapterDuration > 0 && typeof mediaSession.setPositionState === 'function') {
      try {
        mediaSession.setPositionState({
          duration: s.chapterDuration,
          position: Math.min(Math.max(s.chapterElapsed, 0), s.chapterDuration),
          // EPUB times are already estimated at the current speed.
          playbackRate: s.kind === 'audio' ? s.rate || 1 : 1,
        });
      } catch {
        // Transient invalid values (e.g. mid-seek): skip this update.
      }
    }
  });

  return () => {
    stop();
    for (const action of ACTIONS) setHandler(action, null);
  };
}
