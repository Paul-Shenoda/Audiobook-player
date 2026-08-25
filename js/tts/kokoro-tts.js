import { registerProviderMeta, registerTTSProviderFactory } from './provider-interface.js';
import { encodeWavBlob } from './wav-encoder.js';

/**
 * Kokoro-82M offline TTS provider. Runs entirely in the browser via a Web
 * Worker + WASM/WebGPU (through the `kokoro-js` package, which wraps
 * Transformers.js) — no server, no API key, no per-character billing.
 *
 * Unlike every other provider, this one has a one-time ~90MB model download
 * that must be explicitly triggered by the user (see downloadModel below):
 * synthesize() deliberately throws rather than silently fetching that much
 * data the first time someone hits "play".
 */

const MODEL_DOWNLOADED_KEY = 'kokoro-model-downloaded-v1';
const DEFAULT_VOICE_ID = 'af_heart';

/**
 * Kokoro's shipped voice list (kokoro-js@1.2.1 / onnx-community/Kokoro-82M-v1.0-ONNX),
 * grouped the same way the package's own README documents them. Labels below
 * fold in each voice's accent + gender so they read clearly in a plain
 * dropdown without needing the package's quality-grade table alongside them.
 * @type {import('./provider-interface.js').TTSVoice[]}
 */
export const KOKORO_VOICES = [
  // American English — female
  { id: 'af_heart', name: 'Heart (American Female)' },
  { id: 'af_alloy', name: 'Alloy (American Female)' },
  { id: 'af_aoede', name: 'Aoede (American Female)' },
  { id: 'af_bella', name: 'Bella (American Female)' },
  { id: 'af_jessica', name: 'Jessica (American Female)' },
  { id: 'af_kore', name: 'Kore (American Female)' },
  { id: 'af_nicole', name: 'Nicole (American Female)' },
  { id: 'af_nova', name: 'Nova (American Female)' },
  { id: 'af_river', name: 'River (American Female)' },
  { id: 'af_sarah', name: 'Sarah (American Female)' },
  { id: 'af_sky', name: 'Sky (American Female)' },
  // American English — male
  { id: 'am_adam', name: 'Adam (American Male)' },
  { id: 'am_echo', name: 'Echo (American Male)' },
  { id: 'am_eric', name: 'Eric (American Male)' },
  { id: 'am_fenrir', name: 'Fenrir (American Male)' },
  { id: 'am_liam', name: 'Liam (American Male)' },
  { id: 'am_michael', name: 'Michael (American Male)' },
  { id: 'am_onyx', name: 'Onyx (American Male)' },
  { id: 'am_puck', name: 'Puck (American Male)' },
  { id: 'am_santa', name: 'Santa (American Male)' },
  // British English — female
  { id: 'bf_alice', name: 'Alice (British Female)' },
  { id: 'bf_emma', name: 'Emma (British Female)' },
  { id: 'bf_isabella', name: 'Isabella (British Female)' },
  { id: 'bf_lily', name: 'Lily (British Female)' },
  // British English — male
  { id: 'bm_daniel', name: 'Daniel (British Male)' },
  { id: 'bm_fable', name: 'Fable (British Male)' },
  { id: 'bm_george', name: 'George (British Male)' },
  { id: 'bm_lewis', name: 'Lewis (British Male)' },
];

export const KOKORO_LIMITATIONS =
  '~90MB one-time download (uses mobile data if not on Wi-Fi). Runs entirely on your device — noticeably slower on older phones without WebGPU support (iOS only gained WebGPU in Safari 26), and uses more battery/CPU than the built-in voice. Currently English-only. Quality is a clear step up from the built-in voice, but not equal to a paid AI narrator like ElevenLabs.';

/** @type {Worker|null} */
let worker = null;
let nextRequestId = 0;
/** @type {Map<number, { resolve: (value: any) => void, reject: (err: Error) => void, onProgress?: (progress: unknown) => void }>} */
const pending = new Map();

/**
 * Lazily create the shared worker (created on first use, reused after).
 * @returns {Worker}
 */
function getWorker() {
  if (worker) return worker;

  worker = new Worker(new URL('./kokoro-worker.js', import.meta.url), { type: 'module' });

  worker.onmessage = (event) => {
    const { id, type } = event.data;
    const entry = pending.get(id);
    if (!entry) return;

    if (type === 'progress') {
      entry.onProgress?.(event.data.progress);
      return; // request stays pending until 'loaded'/'result'/'error'
    }

    pending.delete(id);
    if (type === 'error') {
      entry.reject(new Error(event.data.error || 'Kokoro worker error'));
    } else if (type === 'loaded') {
      entry.resolve(undefined);
    } else if (type === 'result') {
      entry.resolve({ pcm: event.data.pcm, sampleRate: event.data.sampleRate });
    }
  };

  worker.onerror = (event) => {
    const err = new Error(
      `Kokoro worker failed to load — falling back to the built-in voice (${event.message || 'unknown error'})`,
    );
    for (const entry of pending.values()) entry.reject(err);
    pending.clear();
    // Reset so a future call gets a fresh worker instead of one stuck in a
    // failed/unloadable state.
    worker = null;
  };

  return worker;
}

/**
 * @param {Object} message
 * @param {(progress: unknown) => void} [onProgress]
 * @returns {Promise<any>}
 */
function callWorker(message, onProgress) {
  return new Promise((resolve, reject) => {
    const id = nextRequestId++;
    pending.set(id, { resolve, reject, onProgress });
    try {
      getWorker().postMessage({ id, ...message });
    } catch (err) {
      pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Prefer WebGPU when the browser supports it (faster inference); fall back
 * to WASM everywhere else. Dtype is pinned to "q8" (int8 quantized) on both
 * paths — kokoro-js's README suggests "fp32" for WebGPU, but that model is
 * ~4x larger, which would make the disclosed "~90MB download" limitations
 * text wrong depending on which execution provider a given device picked.
 * Keeping dtype fixed keeps the download size predictable and honest; the
 * WebGPU speed benefit still comes from the execution provider itself.
 * @returns {{ device: 'wasm'|'webgpu', dtype: 'q8' }}
 */
function selectRuntime() {
  const hasWebGPU = typeof navigator !== 'undefined' && !!navigator.gpu;
  return { device: hasWebGPU ? 'webgpu' : 'wasm', dtype: 'q8' };
}

/**
 * Best-effort, synchronous check of whether the Kokoro model has already
 * been downloaded in this browser. Backed by a localStorage flag set after
 * a successful downloadModel() call — not a live probe of the underlying
 * Cache API (whose exact entries are an internal implementation detail of
 * kokoro-js/transformers.js) — so it can occasionally under-report if the
 * user cleared just this flag but not site storage. It never over-reports
 * in a harmful way: if the cache was actually cleared too, a later
 * downloadModel() call simply re-fetches, same as a first-time download.
 * @returns {boolean}
 */
export function isKokoroModelDownloaded() {
  try {
    return localStorage.getItem(MODEL_DOWNLOADED_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Download (or resume from the browser's own HTTP cache) the Kokoro model
 * and construct the runtime session, via the worker. Safe to call more than
 * once — the worker only loads the model once and later calls resolve
 * immediately once it's ready.
 * @param {(progress: unknown) => void} [onProgress] called zero or more
 *   times with kokoro-js/Transformers.js's raw progress event
 *   ({status, file, progress, loaded, total}-shaped) for each file fetched.
 * @returns {Promise<void>}
 */
export async function downloadKokoroModel(onProgress) {
  const { device, dtype } = selectRuntime();
  await callWorker({ type: 'load', dtype, device }, onProgress);
  try {
    localStorage.setItem(MODEL_DOWNLOADED_KEY, 'true');
  } catch {
    // Storage unavailable (private mode, quota) — the model still loaded
    // successfully in the worker for this page session, we just won't
    // remember it across reloads.
  }
}

/**
 * @param {Object} [config] per-provider config from TTSSettings.providerConfigs.kokoro
 * @returns {import('./provider-interface.js').TTSProvider & {
 *   isModelDownloaded: () => boolean,
 *   downloadModel: (onProgress?: (progress: unknown) => void) => Promise<void>,
 * }}
 */
export function createKokoroProvider(config = {}) {
  return {
    id: 'kokoro',
    name: 'Kokoro (offline, natural voice)',

    isModelDownloaded: isKokoroModelDownloaded,
    downloadModel: downloadKokoroModel,

    async listVoices() {
      return KOKORO_VOICES;
    },

    /**
     * @param {string} text
     * @param {string} voiceId
     * @param {{ rate?: number }} [options]
     * @returns {Promise<Blob>}
     */
    async synthesize(text, voiceId, options = {}) {
      if (!isKokoroModelDownloaded()) {
        throw new Error(
          'Kokoro voice model is not downloaded yet — call downloadModel() first (offer the user a "Download offline voice" prompt) before synthesizing.',
        );
      }

      const { device, dtype } = selectRuntime();
      const { pcm, sampleRate } = await callWorker({
        type: 'synthesize',
        text,
        voiceId: voiceId || config.voiceId || DEFAULT_VOICE_ID,
        speed: options.rate ?? 1,
        dtype,
        device,
      });

      return encodeWavBlob(pcm, sampleRate);
    },

    estimateCost: () => 0,
  };
}

registerProviderMeta({
  id: 'kokoro',
  name: 'Kokoro (offline)',
  tier: 'free',
  description:
    'A much more natural free voice than the built-in one — runs entirely on your device.',
  limitations: KOKORO_LIMITATIONS,
});

registerTTSProviderFactory('kokoro', (config) => createKokoroProvider(config));
