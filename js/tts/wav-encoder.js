/**
 * Minimal WAV (RIFF/WAVE, 16-bit PCM) encoder. Kokoro (and most in-browser
 * TTS/ML audio pipelines) hand back raw 32-bit float PCM samples in [-1, 1]
 * plus a sample rate — this wraps that into a standard mono WAV file so it
 * can be handed to an <audio> element as a Blob, same as any other TTS
 * provider's response.
 */

const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS = 1; // Kokoro outputs mono audio.

/**
 * @param {DataView} view
 * @param {number} offset
 * @param {string} str
 */
function writeAscii(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Encode raw float32 PCM samples (range [-1, 1]) into a mono 16-bit WAV file.
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @returns {Blob} a Blob with type 'audio/wav'
 */
export function encodeWavBlob(samples, sampleRate) {
  const bytesPerSample = BITS_PER_SAMPLE / 8;
  const blockAlign = NUM_CHANNELS * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true); // total file size - 8, little-endian
  writeAscii(view, 8, 'WAVE');

  // fmt sub-chunk
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size (16 for PCM)
  view.setUint16(20, 1, true); // audio format: 1 = PCM
  view.setUint16(22, NUM_CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);

  // data sub-chunk
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += bytesPerSample) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, Math.round(int16), true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
