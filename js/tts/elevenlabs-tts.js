import {
  registerProviderMeta,
  registerTTSProviderFactory,
  TTSQuotaExceededError,
} from './provider-interface.js';

const API_BASE = 'https://api.elevenlabs.io/v1';

/**
 * Best-effort parse of an error response body as JSON. ElevenLabs always
 * returns JSON error bodies, but we don't want a malformed/empty body to
 * throw inside our own error-handling path.
 * @param {Response} response
 * @returns {Promise<any>}
 */
async function parseErrorBody(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * ElevenLabs' error bodies nest the machine-readable status under
 * `detail.status` (e.g. `{"detail":{"status":"quota_exceeded",...}}`), but
 * we also accept a top-level `status` in case that ever shows up, since the
 * exact shape has drifted before.
 * @param {any} body
 * @returns {string|undefined}
 */
function errorStatus(body) {
  return body?.detail?.status ?? body?.status;
}

/**
 * ElevenLabs TTS provider (BYOK — called directly from the browser with the
 * user's own API key, no proxy involved).
 * @param {string} apiKey
 * @returns {import('./provider-interface.js').TTSProvider}
 */
export function createElevenLabsProvider(apiKey) {
  return {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    async listVoices() {
      const response = await fetch(`${API_BASE}/voices`, {
        headers: {
          'xi-api-key': apiKey,
        },
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Failed to load ElevenLabs voices: ${response.status} ${detail}`);
      }

      const data = await response.json();
      return (data.voices || []).map((voice) => ({
        id: voice.voice_id,
        name: voice.name,
      }));
    },
    // eslint-disable-next-line no-unused-vars
    async synthesize(text, voiceId, options = {}) {
      // ElevenLabs' TTS endpoint has no simple speed/rate parameter the way
      // OpenAI's does, so options.rate is intentionally ignored here.
      // Playback speed is instead applied client-side via audio.playbackRate.
      const response = await fetch(`${API_BASE}/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
        }),
      });

      if (!response.ok) {
        const body = await parseErrorBody(response);
        const status = errorStatus(body);

        if (response.status === 401 && status === 'quota_exceeded') {
          throw new TTSQuotaExceededError(
            'ElevenLabs monthly quota exceeded',
          );
        }

        if (response.status === 401) {
          // Any other 401 body shape (e.g. invalid/bad API key) is a real
          // problem, not quota rotation — must NOT be silently swallowed as
          // if it were normal fallback-chain behavior.
          const message = body?.detail?.message || body?.message || 'invalid API key';
          throw new Error(`ElevenLabs authentication failed: ${message}`);
        }

        if (response.status === 429) {
          // Transient rate/concurrency limiting (status is typically
          // "too_many_concurrent_requests" or "system_busy") — not the
          // monthly quota, so this is a regular Error, not
          // TTSQuotaExceededError.
          const message = body?.detail?.message || body?.message || 'rate limited';
          throw new Error(`ElevenLabs request throttled (${response.status}): ${message}`);
        }

        const message = body?.detail?.message || body?.message || (await response.text().catch(() => ''));
        throw new Error(`ElevenLabs TTS request failed: ${response.status} ${message}`);
      }

      return await response.blob();
    },
    // No estimateCost: ElevenLabs is wired in for its free tier as part of
    // a multi-provider fallback chain, not as a paid option in this app.
  };
}

registerProviderMeta({
  id: 'elevenlabs',
  name: 'ElevenLabs',
  tier: 'byok',
  description:
    'The best-sounding AI narrator of the bunch — free tier is small (10k characters/month) but genuinely expressive.',
  configFields: [
    {
      key: 'apiKey',
      label: 'ElevenLabs API Key',
      type: 'password',
      placeholder: 'sk_...',
      help: 'Stored locally in your browser. Free tier: 10,000 characters/month.',
    },
  ],
});

registerTTSProviderFactory('elevenlabs', (config) =>
  createElevenLabsProvider(config.apiKey),
);
