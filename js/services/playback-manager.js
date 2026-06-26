import { TTSRouter } from '../tts/tts-router.js';

/**
 * @typedef {import('../storage/library-db.js').Book} Book
 */

/**
 * Global playback state for mini-player and cross-view navigation.
 */
export const playbackManager = {
  /** @type {Book|null} */
  book: null,
  /** @type {'mp3'|'epub'|null} */
  type: null,
  /** @type {HTMLAudioElement|null} */
  audio: null,
  /** @type {TTSRouter} */
  tts: new TTSRouter(),
  /** @type {boolean} */
  isPlaying: false,
  /** @type {boolean} */
  isPaused: false,
  /** @type {(() => void)|null} */
  onStateChange: null,

  /**
   * @param {Book} book
   * @param {'mp3'|'epub'} type
   */
  setActive(book, type) {
    this.book = book;
    this.type = type;
    this.notify();
  },

  setPlaying(playing) {
    this.isPlaying = playing;
    this.isPaused = !playing;
    this.notify();
  },

  setPaused(paused) {
    this.isPaused = paused;
    this.isPlaying = !paused;
    this.notify();
  },

  clear() {
    this.book = null;
    this.type = null;
    this.isPlaying = false;
    this.isPaused = false;
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
    this.tts.stop();
    this.notify();
  },

  notify() {
    this.onStateChange?.();
  },
};
