import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGoogleProvider } from '../js/tts/google-tts.js';
import { getMonthlyUsage } from '../js/tts/usage-tracker.js';
import { TTSQuotaExceededError } from '../js/tts/provider-interface.js';

function base64Of(str) {
  return Buffer.from(str, 'binary').toString('base64');
}

describe('Google Cloud TTS provider', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('decodes a successful synthesize response into an audio/mpeg Blob', async () => {
    const fakeAudio = 'fake-mp3-bytes';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ audioContent: base64Of(fakeAudio) }),
    });

    // Spy on the Blob constructor to verify the exact bytes it was built
    // from, since jsdom's Blob doesn't implement arrayBuffer()/text().
    const OriginalBlob = global.Blob;
    let capturedParts;
    let capturedOptions;
    global.Blob = class extends OriginalBlob {
      constructor(parts, options) {
        super(parts, options);
        capturedParts = parts;
        capturedOptions = options;
      }
    };

    try {
      const provider = createGoogleProvider('test-key');
      const blob = await provider.synthesize('Hello world', 'en-US-Neural2-F', { rate: 1 });

      expect(blob).toBeInstanceOf(OriginalBlob);
      expect(blob.type).toBe('audio/mpeg');
      expect(blob.size).toBe(fakeAudio.length);
      expect(capturedOptions).toEqual({ type: 'audio/mpeg' });
      const bytes = capturedParts[0];
      expect(Array.from(bytes)).toEqual(Array.from(fakeAudio, (c) => c.charCodeAt(0)));
    } finally {
      global.Blob = OriginalBlob;
    }

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('text:synthesize');
  });

  it('throws TTSQuotaExceededError without calling fetch when the monthly budget would be exceeded', async () => {
    global.fetch = vi.fn();
    localStorage.setItem(
      `tts-usage:google:${new Date().getFullYear()}-${new Date().getMonth()}`,
      String(999_999),
    );

    const provider = createGoogleProvider('test-key');

    await expect(provider.synthesize('x'.repeat(2), 'en-US-Neural2-F', {})).rejects.toThrow(
      TTSQuotaExceededError,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('throws a plain Error (not TTSQuotaExceededError) on a RESOURCE_EXHAUSTED response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({
        error: { code: 429, message: 'Too many requests', status: 'RESOURCE_EXHAUSTED' },
      }),
    });

    const provider = createGoogleProvider('test-key');

    let caught;
    try {
      await provider.synthesize('Hello', 'en-US-Neural2-F', {});
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(TTSQuotaExceededError);
    expect(caught.message).toBe('Too many requests');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('accumulates usage across two successful calls that stay under budget', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ audioContent: base64Of('abc') }),
    });

    const provider = createGoogleProvider('test-key');

    await provider.synthesize('a'.repeat(100), 'en-US-Neural2-F', {});
    expect(getMonthlyUsage('google')).toBe(100);

    await provider.synthesize('b'.repeat(250), 'en-US-Neural2-F', {});
    expect(getMonthlyUsage('google')).toBe(350);

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
