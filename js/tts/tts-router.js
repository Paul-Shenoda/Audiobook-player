import { WebSpeechTTS } from './web-speech.js';
import { cacheKey, getCachedAudio, setCachedAudio } from './chunk-cache.js';
import { getProviderFactory, TTSQuotaExceededError } from './provider-interface.js';
import './openai-tts.js'; // side effect: registers its provider factory/metadata

const SETTINGS_KEY = 'tts-settings';

/**
 * @typedef {Object} TTSSettings
 * @property {number} rate
 * @property {string[]} providerChain ordered ids of enabled BYOK/local
 *   providers to try, in priority order. Web Speech is always the implicit
 *   final fallback and is never itself a member of this list.
 * @property {Object<string, Object>} providerConfigs per-provider config
 *   (credentials, voiceId, etc.), keyed by provider id — shape is
 *   provider-specific, see each provider's configFields.
 * @property {string} webSpeechVoiceId
 */

/** @returns {TTSSettings} */
export function loadTTSSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return migrateSettings({ ...defaultSettings(), ...JSON.parse(raw) });
  } catch {
    // ignore
  }
  return defaultSettings();
}

/** @returns {TTSSettings} */
export function defaultSettings() {
  return {
    rate: 1,
    providerChain: [],
    providerConfigs: {},
    webSpeechVoiceId: '',
  };
}

/**
 * Upgrades the old single-provider settings shape ({providerId, voiceId,
 * apiKey, proxyUrl}) to the new provider-chain shape, once, transparently,
 * so settings saved before this feature existed still work.
 * @param {Object} settings
 * @returns {TTSSettings}
 */
function migrateSettings(settings) {
  if (settings.providerId === undefined) return settings;

  const { providerId, voiceId, apiKey, proxyUrl, ...rest } = settings;
  const migrated = { ...defaultSettings(), ...rest };

  if (providerId === 'web-speech') {
    migrated.webSpeechVoiceId = voiceId ?? '';
  } else if (providerId) {
    migrated.providerChain = [providerId];
    migrated.providerConfigs = { [providerId]: { apiKey, proxyUrl, voiceId } };
  }

  return migrated;
}

/**
 * @param {TTSSettings} settings
 */
export function saveTTSSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Orchestrates TTS playback across a chain of providers with chunk caching.
 * On a quota-exceeded error from the active provider, silently advances to
 * the next configured provider and retries the same chunk; any other error
 * falls back to Web Speech, same as before this feature existed.
 */
export class TTSRouter {
  constructor() {
    this.webSpeech = new WebSpeechTTS();
    /** @type {import('./provider-interface.js').TTSProvider[]} */
    this.providerChain = [];
    this.chainIndex = 0;
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
    /** @type {Map<string, Promise<Blob>>} in-flight synth requests by cache key */
    this.inflightSynth = new Map();
    /** @type {((index: number) => void)|null} */
    this.onChunkStart = null;
    /** @type {(() => void)|null} */
    this.onComplete = null;
    /** @type {((error: Error) => void)|null} */
    this.onError = null;
    /** @type {((providerName: string) => void)|null} fires when the chain silently advances past a quota-exhausted provider */
    this.onProviderFallback = null;
  }

  /**
   * Apply settings to this router. Does not persist — call saveTTSSettings
   * explicitly when the user commits a change.
   * @param {TTSSettings} settings
   */
  configure(settings) {
    this.settings = settings;
    this.providerChain = (settings.providerChain ?? [])
      .map((id) => {
        const factory = getProviderFactory(id);
        if (!factory) return null;
        const config = { ...(settings.providerConfigs?.[id] ?? {}), rate: settings.rate };
        return factory(config);
      })
      .filter(Boolean);
    this.chainIndex = 0;
    this.aiProvider = this.providerChain[0] ?? null;
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

    if (this.aiProvider) {
      await this.playAIChunk();
    } else {
      this.playWebSpeech(startIndex);
    }
  }

  /**
   * Fall back to Web Speech when the whole provider chain has failed.
   * @param {number} startIndex
   */
  fallbackToWebSpeech(startIndex) {
    this.providerChain = [];
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
    if (this.settings.webSpeechVoiceId) {
      this.webSpeech.setVoice(this.settings.webSpeechVoiceId);
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

  /**
   * Get chunk audio from cache, an in-flight request, or a fresh synthesis.
   * Audio is always synthesized at 1x — playback speed is applied via
   * audio.playbackRate — so cached chunks stay valid across speed changes.
   * @param {number} index
   * @returns {Promise<Blob>}
   */
  async getChunkAudio(index) {
    const providerId = this.aiProvider.id;
    const voiceId = this.settings.providerConfigs?.[providerId]?.voiceId || '';
    const key = cacheKey(this.bookId, this.chapterIndex, index, voiceId, providerId);

    const cached = await getCachedAudio(key);
    if (cached) return cached;

    const inflight = this.inflightSynth.get(key);
    if (inflight) return inflight;

    const request = (async () => {
      const blob = await this.aiProvider.synthesize(this.chunks[index], voiceId, {
        rate: this.settings.rate,
      });
      await setCachedAudio(key, blob, this.bookId);
      return blob;
    })().finally(() => {
      this.inflightSynth.delete(key);
    });
    this.inflightSynth.set(key, request);
    return request;
  }

  /**
   * Warm the cache for the next chunk while the current one plays,
   * so chunk transitions are gapless. Best-effort.
   * @param {number} index
   */
  prefetchChunk(index) {
    if (!this.aiProvider || index >= this.chunks.length) return;
    this.getChunkAudio(index).catch(() => {});
  }

  async playAIChunk() {
    if (this.chunkIndex >= this.chunks.length) {
      this.playing = false;
      this.onComplete?.();
      return;
    }

    this.onChunkStart?.(this.chunkIndex);

    try {
      const blob = await this.getChunkAudio(this.chunkIndex);

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

      this.prefetchChunk(this.chunkIndex + 1);
      await this.audio.play();
    } catch (err) {
      if (err instanceof TTSQuotaExceededError && this.chainIndex < this.providerChain.length - 1) {
        this.chainIndex += 1;
        this.aiProvider = this.providerChain[this.chainIndex];
        this.onProviderFallback?.(this.aiProvider.name);
        await this.playAIChunk();
        return;
      }

      this.playing = false;
      if (this.aiProvider) {
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
    if (this.aiProvider) {
      this.audio?.pause();
    } else {
      this.webSpeech.pause();
    }
  }

  resume() {
    this.paused = false;
    if (this.aiProvider) {
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
    if (this.aiProvider) {
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
    if (this.aiProvider) {
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
