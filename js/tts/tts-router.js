import { WebSpeechTTS } from './web-speech.js';
import { cacheKey, getCachedAudio, setCachedAudio } from './chunk-cache.js';
import { createOpenAIProvider } from './openai-tts.js';

const SETTINGS_KEY = 'tts-settings';

/**
 * @typedef {Object} TTSSettings
 * @property {string} providerId
 * @property {string} voiceId
 * @property {number} rate
 * @property {string} apiKey
 * @property {string} proxyUrl
 */

/** @returns {TTSSettings} */
export function loadTTSSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return defaultSettings();
}

/** @returns {TTSSettings} */
export function defaultSettings() {
  return {
    providerId: 'web-speech',
    voiceId: '',
    rate: 1,
    apiKey: '',
    proxyUrl: '/api/tts',
  };
}

/**
 * @param {TTSSettings} settings
 */
export function saveTTSSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Orchestrates TTS playback across providers with chunk caching.
 */
export class TTSRouter {
  constructor() {
    this.webSpeech = new WebSpeechTTS();
    /** @type {import('./provider-interface.js').TTSProvider|null} */
    this.aiProvider = null;
    this.settings = loadTTSSettings();
    /** @type {string[]} */
    this.chunks = [];
    this.chunkIndex = 0;
    /** @type {HTMLAudioElement|null} */
    this.audio = null;
    this.playing = false;
    this.paused = false;
    this.bookId = '';
    this.chapterIndex = 0;
    /** @type {((index: number) => void)|null} */
    this.onChunkStart = null;
    /** @type {(() => void)|null} */
    this.onComplete = null;
    /** @type {((error: Error) => void)|null} */
    this.onError = null;
  }

  /**
   * @param {TTSSettings} settings
   */
  configure(settings) {
    this.settings = settings;
    saveTTSSettings(settings);

    if (settings.providerId === 'openai') {
      this.aiProvider = createOpenAIProvider(settings.proxyUrl, settings.apiKey);
    } else {
      this.aiProvider = null;
    }
  }

  /**
   * @param {string[]} chunks
   * @param {number} startIndex
   * @param {{ bookId?: string, chapterIndex?: number }} context
   */
  async speak(chunks, startIndex = 0, context = {}) {
    this.stop(false);
    this.chunks = chunks;
    this.chunkIndex = startIndex;
    this.bookId = context.bookId ?? '';
    this.chapterIndex = context.chapterIndex ?? 0;
    this.playing = true;
    this.paused = false;

    if (this.settings.providerId === 'openai' && this.aiProvider) {
      await this.playAIChunk();
    } else {
      this.playWebSpeech(startIndex);
    }
  }

  /**
   * Fall back to Web Speech when AI TTS fails.
   * @param {number} startIndex
   */
  fallbackToWebSpeech(startIndex) {
    this.settings = { ...this.settings, providerId: 'web-speech' };
    this.aiProvider = null;
    if (this.audio) {
      this.audio.pause();
      URL.revokeObjectURL(this.audio.src);
      this.audio = null;
    }
    this.playing = true;
    this.paused = false;
    this.playWebSpeech(startIndex);
  }

  playWebSpeech(startIndex) {
    if (this.settings.voiceId) {
      this.webSpeech.setVoice(this.settings.voiceId);
    }
    this.webSpeech.setRate(this.settings.rate);
    this.webSpeech.onChunkStart = (index) => this.onChunkStart?.(index);
    this.webSpeech.onComplete = () => {
      this.playing = false;
      this.onComplete?.();
    };
    this.webSpeech.onError = (err) => {
      this.playing = false;
      this.onError?.(err);
    };
    this.webSpeech.speak(this.chunks, startIndex);
  }

  async playAIChunk() {
    if (this.chunkIndex >= this.chunks.length) {
      this.playing = false;
      this.onComplete?.();
      return;
    }

    this.onChunkStart?.(this.chunkIndex);
    const text = this.chunks[this.chunkIndex];
    const voiceId = this.settings.voiceId || 'nova';
    const key = cacheKey(
      this.bookId,
      this.chapterIndex,
      this.chunkIndex,
      voiceId,
      'openai',
    );

    try {
      let blob = await getCachedAudio(key);
      if (!blob) {
        blob = await this.aiProvider.synthesize(text, voiceId, {
          rate: this.settings.rate,
        });
        await setCachedAudio(key, blob, this.bookId);
      }

      if (this.audio) {
        this.audio.pause();
        URL.revokeObjectURL(this.audio.src);
      }

      this.audio = new Audio(URL.createObjectURL(blob));
      this.audio.playbackRate = this.settings.rate;

      this.audio.onended = () => {
        if (this.paused) return;
        this.chunkIndex += 1;
        this.playAIChunk();
      };

      this.audio.onerror = () => {
        this.playing = false;
        this.onError?.(new Error('Audio playback failed'));
      };

      await this.audio.play();
    } catch (err) {
      this.playing = false;
      if (this.settings.providerId === 'openai') {
        this.onError?.(
          new Error(
            `${err instanceof Error ? err.message : String(err)} — falling back to Web Speech`,
          ),
        );
        this.fallbackToWebSpeech(this.chunkIndex);
      }
    }
  }

  pause() {
    this.paused = true;
    if (this.settings.providerId === 'openai' && this.aiProvider) {
      this.audio?.pause();
    } else {
      this.webSpeech.pause();
    }
  }

  resume() {
    this.paused = false;
    if (this.settings.providerId === 'openai' && this.aiProvider) {
      this.audio?.play().catch(() => {});
    } else {
      this.webSpeech.resume();
    }
  }

  stop(clearQueue = true) {
    this.webSpeech.stop(clearQueue);
    if (this.audio) {
      this.audio.pause();
      URL.revokeObjectURL(this.audio.src);
      this.audio = null;
    }
    this.playing = false;
    this.paused = false;
    if (clearQueue) {
      this.chunks = [];
      this.chunkIndex = 0;
    }
  }

  /**
   * @returns {Promise<import('./provider-interface.js').TTSVoice[]>}
   */
  async listVoices() {
    if (this.settings.providerId === 'openai' && this.aiProvider) {
      return this.aiProvider.listVoices();
    }
    return this.webSpeech.listVoices();
  }

  /**
   * Update playback rate immediately, even while speaking.
   * @param {number} rate
   */
  setRate(rate) {
    this.settings = { ...this.settings, rate };
    saveTTSSettings(this.settings);
    this.webSpeech.setRate(rate);
    if (this.audio) {
      this.audio.playbackRate = rate;
    }
  }

  getCurrentChunkIndex() {
    if (this.settings.providerId === 'openai' && this.aiProvider) {
      return this.chunkIndex;
    }
    return this.webSpeech.getCurrentChunkIndex();
  }

  isPaused() {
    return this.paused;
  }

  isPlaying() {
    return this.playing;
  }
}
