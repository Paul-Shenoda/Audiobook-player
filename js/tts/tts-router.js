import { WebSpeechTTS } from './web-speech.js';

const SETTINGS_KEY = 'tts-settings';

/**
 * @typedef {Object} TTSSettings
 * @property {number} rate default speed for a book that has no speed of its own
 * @property {string} webSpeechVoiceId voiceURI of the chosen built-in voice ('' = device default)
 */

/** @returns {TTSSettings} */
export function defaultSettings() {
  return { rate: 1, webSpeechVoiceId: '' };
}

/**
 * Reads the saved settings. Only the two known fields are kept, so anything
 * an older version saved (other voice providers, keys) is ignored.
 * @returns {TTSSettings}
 */
export function loadTTSSettings() {
  const settings = defaultSettings();
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (typeof saved?.rate === 'number') settings.rate = saved.rate;
    if (typeof saved?.webSpeechVoiceId === 'string') settings.webSpeechVoiceId = saved.webSpeechVoiceId;
  } catch {
    // ignore: fall back to defaults
  }
  return settings;
}

/**
 * @param {TTSSettings} settings
 */
export function saveTTSSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * The one narrator: EPUB text read aloud with the device's built-in voice
 * (Web Speech). It owns the saved settings (speed, voice) and forwards
 * events from the speech wrapper, which keeps the position by word.
 */
export class TTSRouter {
  constructor() {
    this.webSpeech = new WebSpeechTTS();
    this.settings = loadTTSSettings();
    this.playing = false;
    /** @type {((index: number, charIndex: number) => void)|null} */
    this.onChunkStart = null;
    /** @type {((index: number, charIndex: number) => void)|null} word boundary */
    this.onProgress = null;
    /** @type {(() => void)|null} */
    this.onComplete = null;
    /** @type {((error: Error) => void)|null} */
    this.onError = null;
  }

  /**
   * Apply settings to this narrator. Does not persist: call saveTTSSettings
   * explicitly when the user commits a change.
   * @param {TTSSettings} settings
   */
  configure(settings) {
    this.settings = settings;
  }

  /**
   * @param {string[]} chunks
   * @param {number} startIndex
   * @param {{ startChar?: number }} [context] startChar: offset inside the first chunk
   */
  speak(chunks, startIndex = 0, context = {}) {
    this.stop(false);
    this.playing = true;
    const speech = this.webSpeech;
    if (this.settings.webSpeechVoiceId) speech.setVoice(this.settings.webSpeechVoiceId);
    speech.setRate(this.settings.rate);
    speech.onChunkStart = (index, charIndex) => this.onChunkStart?.(index, charIndex);
    speech.onProgress = (index, charIndex) => this.onProgress?.(index, charIndex);
    speech.onComplete = () => {
      this.playing = false;
      this.onComplete?.();
    };
    speech.onError = (err) => {
      this.playing = false;
      this.onError?.(err);
    };
    speech.speak(chunks, startIndex, context.startChar ?? 0);
  }

  pause() {
    this.webSpeech.pause();
  }

  resume() {
    this.webSpeech.resume();
  }

  stop(clearQueue = true) {
    this.webSpeech.stop(clearQueue);
    this.playing = false;
  }

  /** @returns {{ id: string, name: string }[]} */
  listVoices() {
    return this.webSpeech.listVoices();
  }

  /**
   * Update speed immediately, even while speaking (it continues from the
   * current word). EPUB listen mode passes { saveAsDefault: false }: its speed
   * is saved per book, so it must not change the default other books use.
   * @param {number} rate
   * @param {{ saveAsDefault?: boolean }} [options]
   */
  setRate(rate, { saveAsDefault = true } = {}) {
    this.settings = { ...this.settings, rate };
    if (saveAsDefault) saveTTSSettings(this.settings);
    this.webSpeech.setRate(rate);
  }

  getCurrentChunkIndex() {
    return this.webSpeech.getCurrentChunkIndex();
  }

  isPaused() {
    return this.webSpeech.isPaused();
  }

  isPlaying() {
    return this.playing;
  }
}

/** The one narrator the player uses, so every view and engine controls the same speech. */
export const sharedTtsRouter = new TTSRouter();
