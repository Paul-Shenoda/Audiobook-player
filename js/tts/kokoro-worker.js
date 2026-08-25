/**
 * Web Worker that hosts the Kokoro-82M model (via the `kokoro-js` package).
 * Runs entirely off the main thread so inference never blocks the UI.
 *
 * This whole worker script (and the `kokoro-js` import below) is only ever
 * loaded lazily — the main thread (kokoro-tts.js) constructs this worker on
 * first use, not at app startup. Note that importing `kokoro-js` itself does
 * NOT fetch the ~90MB model: that only happens inside KokoroTTS.from_pretrained(),
 * which this worker only calls in response to an explicit 'load' or
 * 'synthesize' message — i.e. still only once the user has opted in.
 *
 * (We use a static top-level import here rather than a dynamic import()
 * inside the message handler: Vite's default worker output format is IIFE,
 * which Rollup refuses to code-split, and a dynamic import() inside a
 * worker module forces exactly that. A static import keeps this one chunk.)
 *
 * Protocol (all messages carry an `id` echoed back on every reply so the
 * main thread can correlate requests to responses):
 *   -> { id, type: 'load', dtype, device }
 *   <- { id, type: 'progress', progress: <raw kokoro-js/transformers.js progress event> }  (zero or more)
 *   <- { id, type: 'loaded' }  |  { id, type: 'error', error }
 *
 *   -> { id, type: 'synthesize', text, voiceId, speed, dtype, device }
 *   <- { id, type: 'result', pcm: Float32Array (transferred), sampleRate }  |  { id, type: 'error', error }
 */
import { KokoroTTS } from 'kokoro-js';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

/** @type {Promise<import('kokoro-js').KokoroTTS>|null} */
let ttsPromise = null;

/**
 * Lazily create (and cache) the single KokoroTTS instance for this worker's
 * lifetime. Safe to call repeatedly — later calls reuse the in-flight or
 * resolved promise instead of re-loading the model.
 * @param {'fp32'|'fp16'|'q8'|'q4'|'q4f16'} dtype
 * @param {'wasm'|'webgpu'} device
 * @param {(progress: unknown) => void} [onProgress]
 */
function getTTS(dtype, device, onProgress) {
  if (!ttsPromise) {
    ttsPromise = KokoroTTS.from_pretrained(MODEL_ID, {
      dtype,
      device,
      progress_callback: onProgress,
    }).catch((err) => {
      // Let the next call retry from scratch instead of being stuck with a
      // permanently-rejected promise after a transient failure (e.g. a
      // dropped connection mid-download).
      ttsPromise = null;
      throw err;
    });
  }
  return ttsPromise;
}

self.onmessage = async (event) => {
  const { id, type } = event.data;

  try {
    if (type === 'load') {
      const { dtype, device } = event.data;
      await getTTS(dtype, device, (progress) => {
        self.postMessage({ id, type: 'progress', progress });
      });
      self.postMessage({ id, type: 'loaded' });
      return;
    }

    if (type === 'synthesize') {
      const { text, voiceId, speed, dtype, device } = event.data;
      const tts = await getTTS(dtype, device);
      const audio = await tts.generate(text, { voice: voiceId, speed });
      // audio.audio is a Float32Array of raw PCM samples; audio.sampling_rate
      // is Kokoro's fixed output rate (24kHz as of kokoro-js 1.2.x).
      // Transfer the underlying buffer instead of copying it.
      self.postMessage(
        { id, type: 'result', pcm: audio.audio, sampleRate: audio.sampling_rate },
        [audio.audio.buffer],
      );
      return;
    }

    self.postMessage({ id, type: 'error', error: `Unknown message type: ${type}` });
  } catch (err) {
    self.postMessage({
      id,
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
