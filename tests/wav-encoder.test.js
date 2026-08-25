import { describe, it, expect } from 'vitest';
import { encodeWavBlob } from '../js/tts/wav-encoder.js';

/**
 * jsdom's Blob implementation doesn't support Blob.arrayBuffer(), so read
 * it back through FileReader instead (which jsdom does implement, and
 * which is how this would actually be read in a browser test too).
 * @param {Blob} blob
 * @returns {Promise<ArrayBuffer>}
 */
function readBlobAsArrayBuffer(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe('encodeWavBlob', () => {
  it('produces a Blob with the correct MIME type and byte length', async () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const sampleRate = 24000;

    const blob = encodeWavBlob(samples, sampleRate);

    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + samples.length * 2); // 44-byte header + 16-bit samples
  });

  it('writes a correct RIFF/WAVE header for known input', async () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const sampleRate = 24000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const blockAlign = numChannels * (bitsPerSample / 8);
    const byteRate = sampleRate * blockAlign;
    const dataSize = samples.length * (bitsPerSample / 8);

    const blob = encodeWavBlob(samples, sampleRate);
    const buffer = await readBlobAsArrayBuffer(blob);
    const view = new DataView(buffer);

    const readAscii = (offset, length) => {
      let str = '';
      for (let i = 0; i < length; i++) str += String.fromCharCode(view.getUint8(offset + i));
      return str;
    };

    // RIFF chunk descriptor
    expect(readAscii(0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + dataSize); // file size - 8
    expect(readAscii(8, 4)).toBe('WAVE');

    // fmt sub-chunk
    expect(readAscii(12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16); // PCM fmt chunk size
    expect(view.getUint16(20, true)).toBe(1); // audio format: PCM
    expect(view.getUint16(22, true)).toBe(numChannels);
    expect(view.getUint32(24, true)).toBe(sampleRate);
    expect(view.getUint32(28, true)).toBe(byteRate);
    expect(view.getUint16(32, true)).toBe(blockAlign);
    expect(view.getUint16(34, true)).toBe(bitsPerSample);

    // data sub-chunk
    expect(readAscii(36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(dataSize);
    expect(buffer.byteLength).toBe(44 + dataSize);
  });

  it('correctly converts float32 samples in [-1, 1] to 16-bit signed PCM', async () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const blob = encodeWavBlob(samples, 24000);
    const buffer = await readBlobAsArrayBuffer(blob);
    const view = new DataView(buffer);

    const readSample = (i) => view.getInt16(44 + i * 2, true);

    expect(readSample(0)).toBe(0);
    expect(readSample(1)).toBe(Math.round(0.5 * 0x7fff));
    expect(readSample(2)).toBe(Math.round(-0.5 * 0x8000));
    expect(readSample(3)).toBe(0x7fff); // +1 clamps to max positive int16
    expect(readSample(4)).toBe(-0x8000); // -1 maps to min negative int16
  });

  it('clamps out-of-range samples instead of wrapping', async () => {
    const samples = new Float32Array([1.5, -1.5]);
    const blob = encodeWavBlob(samples, 16000);
    const buffer = await readBlobAsArrayBuffer(blob);
    const view = new DataView(buffer);

    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });

  it('scales byteRate and data chunk size correctly for a different sample rate', async () => {
    const samples = new Float32Array(10).fill(0.1);
    const sampleRate = 44100;
    const blob = encodeWavBlob(samples, sampleRate);
    const buffer = await readBlobAsArrayBuffer(blob);
    const view = new DataView(buffer);

    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(28, true)).toBe(44100 * 2); // byteRate = sampleRate * blockAlign
    expect(view.getUint32(40, true)).toBe(20); // 10 samples * 2 bytes
  });
});
