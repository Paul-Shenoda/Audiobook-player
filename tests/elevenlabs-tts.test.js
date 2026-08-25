import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElevenLabsProvider } from '../js/tts/elevenlabs-tts.js';
import { TTSQuotaExceededError } from '../js/tts/provider-interface.js';

function mockResponse({ ok, status, jsonBody, blobBody }) {
  return {
    ok,
    status,
    json: async () => jsonBody,
    text: async () => JSON.stringify(jsonBody ?? {}),
    blob: async () => blobBody ?? new Blob(['audio'], { type: 'audio/mpeg' }),
  };
}

describe('createElevenLabsProvider', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  describe('synthesize', () => {
    it('returns a Blob on a successful call', async () => {
      const fakeBlob = new Blob(['fake-audio-bytes'], { type: 'audio/mpeg' });
      global.fetch.mockResolvedValue(
        mockResponse({ ok: true, status: 200, blobBody: fakeBlob }),
      );

      const provider = createElevenLabsProvider('test-key');
      const result = await provider.synthesize('Hello world', 'voice-123', { rate: 1.25 });

      expect(result).toBeInstanceOf(Blob);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/text-to-speech/voice-123',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'xi-api-key': 'test-key' }),
        }),
      );
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body).toEqual({ text: 'Hello world', model_id: 'eleven_multilingual_v2' });
    });

    it('throws TTSQuotaExceededError on a 401 with a quota_exceeded status body', async () => {
      global.fetch.mockResolvedValue(
        mockResponse({
          ok: false,
          status: 401,
          jsonBody: {
            detail: {
              status: 'quota_exceeded',
              message: 'This request exceeds your quota of 10000.',
            },
          },
        }),
      );

      const provider = createElevenLabsProvider('test-key');

      await expect(provider.synthesize('text', 'voice-123', {})).rejects.toThrow(
        TTSQuotaExceededError,
      );
    });

    it('throws a plain Error (not TTSQuotaExceededError) on a 401 with a different body (bad key)', async () => {
      global.fetch.mockResolvedValue(
        mockResponse({
          ok: false,
          status: 401,
          jsonBody: {
            detail: {
              status: 'invalid_api_key',
              message: 'Invalid API key.',
            },
          },
        }),
      );

      const provider = createElevenLabsProvider('bad-key');

      let caught;
      try {
        await provider.synthesize('text', 'voice-123', {});
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(TTSQuotaExceededError);
    });

    it('throws a plain Error (not TTSQuotaExceededError) on a 429 rate-limit response', async () => {
      global.fetch.mockResolvedValue(
        mockResponse({
          ok: false,
          status: 429,
          jsonBody: {
            detail: {
              status: 'too_many_concurrent_requests',
              message: 'Too many concurrent requests.',
            },
          },
        }),
      );

      const provider = createElevenLabsProvider('test-key');

      let caught;
      try {
        await provider.synthesize('text', 'voice-123', {});
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(TTSQuotaExceededError);
    });

    it('throws a plain Error on other non-ok responses', async () => {
      global.fetch.mockResolvedValue(
        mockResponse({ ok: false, status: 500, jsonBody: { detail: { message: 'oops' } } }),
      );

      const provider = createElevenLabsProvider('test-key');

      await expect(provider.synthesize('text', 'voice-123', {})).rejects.toThrow(Error);
    });
  });

  describe('listVoices', () => {
    it('maps the API response to {id, name} pairs', async () => {
      global.fetch.mockResolvedValue(
        mockResponse({
          ok: true,
          status: 200,
          jsonBody: {
            voices: [
              { voice_id: 'v1', name: 'Rachel', category: 'premade' },
              { voice_id: 'v2', name: 'Domi', category: 'premade' },
            ],
          },
        }),
      );

      const provider = createElevenLabsProvider('test-key');
      const voices = await provider.listVoices();

      expect(voices).toEqual([
        { id: 'v1', name: 'Rachel' },
        { id: 'v2', name: 'Domi' },
      ]);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/voices',
        expect.objectContaining({ headers: expect.objectContaining({ 'xi-api-key': 'test-key' }) }),
      );
    });

    it('throws on a failed request instead of swallowing the error', async () => {
      global.fetch.mockResolvedValue(mockResponse({ ok: false, status: 401, jsonBody: {} }));

      const provider = createElevenLabsProvider('bad-key');

      await expect(provider.listVoices()).rejects.toThrow();
    });
  });
});
