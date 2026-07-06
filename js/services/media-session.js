import { getBookCoverUrl } from '../utils/cover-art.js';

/**
 * Lock-screen / notification media controls via the Media Session API.
 * No-ops everywhere the API is unavailable.
 *
 * @typedef {import('../storage/library-db.js').Book} Book
 */

const ALL_ACTIONS = [
  'play',
  'pause',
  'stop',
  'seekbackward',
  'seekforward',
  'seekto',
  'previoustrack',
  'nexttrack',
];

function supported() {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator;
}

/**
 * Set lock-screen metadata and action handlers for the active book.
 * Omitted handlers are cleared so stale actions from a previous view
 * never fire.
 *
 * @param {Book} book
 * @param {{
 *   onPlay?: () => void,
 *   onPause?: () => void,
 *   onStop?: () => void,
 *   onSeekBackward?: () => void,
 *   onSeekForward?: () => void,
 *   onSeekTo?: (seconds: number) => void,
 *   onPreviousTrack?: () => void,
 *   onNextTrack?: () => void,
 * }} handlers
 */
export function initMediaSession(book, handlers = {}) {
  if (!supported()) return;

  const coverUrl = getBookCoverUrl(book);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: book.title,
    artist: book.author,
    album: 'Audiobook Library',
    artwork: coverUrl
      ? [{ src: coverUrl, sizes: '512x512', type: book.coverBlob?.type || 'image/png' }]
      : [],
  });

  const actionMap = {
    play: handlers.onPlay,
    pause: handlers.onPause,
    stop: handlers.onStop,
    seekbackward: handlers.onSeekBackward,
    seekforward: handlers.onSeekForward,
    seekto: handlers.onSeekTo
      ? (details) => {
          if (details.seekTime != null) handlers.onSeekTo(details.seekTime);
        }
      : undefined,
    previoustrack: handlers.onPreviousTrack,
    nexttrack: handlers.onNextTrack,
  };

  for (const action of ALL_ACTIONS) {
    try {
      navigator.mediaSession.setActionHandler(action, actionMap[action] ?? null);
    } catch {
      // Browser doesn't support this action — ignore
    }
  }
}

/**
 * @param {'playing'|'paused'|'none'} state
 */
export function setMediaPlaybackState(state) {
  if (!supported()) return;
  navigator.mediaSession.playbackState = state;
}

/**
 * Update the lock-screen scrubber position (MP3 playback).
 * @param {{ duration: number, position: number, playbackRate?: number }} state
 */
export function setMediaPositionState({ duration, position, playbackRate = 1 }) {
  if (!supported() || typeof navigator.mediaSession.setPositionState !== 'function') return;
  if (!Number.isFinite(duration) || duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration,
      position: Math.min(Math.max(position, 0), duration),
      playbackRate,
    });
  } catch {
    // Invalid transient state (e.g. mid-seek) — ignore
  }
}

export function teardownMediaSession() {
  if (!supported()) return;
  navigator.mediaSession.metadata = null;
  navigator.mediaSession.playbackState = 'none';
  for (const action of ALL_ACTIONS) {
    try {
      navigator.mediaSession.setActionHandler(action, null);
    } catch {
      // ignore
    }
  }
}
