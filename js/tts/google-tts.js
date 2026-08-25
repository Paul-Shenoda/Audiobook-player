import {
  registerProviderMeta,
  registerTTSProviderFactory,
  TTSQuotaExceededError,
} from './provider-interface.js';
import { wouldExceedBudget, recordUsage } from './usage-tracker.js';

const API_BASE = 'https://texttospeech.googleapis.com/v1';

// Neural2 free tier: 1,000,000 characters/month. This is the tier this
// provider targets, and the budget it proactively guards against — see the
// module doc comment in usage-tracker.js for why that's necessary at all.
const FREE_CHAR_BUDGET = 1_000_000;

/**
 * Decode a base64 string (as returned in Google's synthesize response) into
 * a Blob of MP3 audio.
 * @param {string} base64
 * @returns {Blob}
 */
function base64ToAudioBlob(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: 'audio/mpeg' });
}

/**
 * Google Cloud Text-to-Speech provider (BYOK).
 *
 * Google's free tier does not error when exceeded — it silently starts
 * billing the user's card instead. So, unlike every other provider here,
 * this one can't rely on catching an API error to detect quota exhaustion;
 * it proactively tracks usage client-side (usage-tracker.js) and throws
 * TTSQuotaExceededError itself, before ever making the network call, once
 * the known free budget would be exceeded.
 * @param {string} apiKey
 * @returns {import('./provider-interface.js').TTSProvider}
 */
export function createGoogleProvider(apiKey) {
  return {
    id: 'google',
    name: 'Google Cloud TTS',
    async listVoices() {
      const response = await fetch(`${API_BASE}/voices?key=${apiKey}`);

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Google TTS voices request failed: ${response.status} ${detail}`);
      }

      const data = await response.json();
      const voices = data.voices ?? [];

      const isEnglish = (voice) =>
        (voice.languageCodes ?? []).some((code) => code.startsWith('en-'));
      const isNeural2 = (voice) => voice.name.includes('Neural2');

      const english = voices.filter(isEnglish);
      const neural2 = english.filter(isNeural2);
      const chosen = neural2.length > 0 ? neural2 : english;

      return chosen.map((voice) => {
        const languageCode = (voice.languageCodes ?? [])[0] ?? 'en-US';
        const genderLabel =
          voice.ssmlGender === 'MALE'
            ? 'Male'
            : voice.ssmlGender === 'FEMALE'
              ? 'Female'
              : 'Neutral';
        const tierLabel = isNeural2(voice) ? 'Neural2' : 'Standard';
        return {
          id: voice.name,
          name: `${tierLabel} - ${genderLabel} (${languageCode})`,
        };
      });
    },
    async synthesize(text, voiceId, options = {}) {
      if (wouldExceedBudget('google', FREE_CHAR_BUDGET, text.length)) {
        throw new TTSQuotaExceededError(
          'Google Cloud TTS free-tier budget (1M characters/month) would be exceeded',
        );
      }

      const response = await fetch(`${API_BASE}/text:synthesize?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: 'en-US', name: voiceId },
          audioConfig: { audioEncoding: 'MP3', speakingRate: options.rate ?? 1 },
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const message = body?.error?.message ?? `Google TTS request failed: ${response.status}`;
        // RESOURCE_EXHAUSTED here is a requests-per-second rate-limit issue,
        // not the monthly free-tier budget (that's handled proactively above,
        // before any network call) — so it's a regular, user-visible error,
        // not TTSQuotaExceededError.
        throw new Error(message);
      }

      const data = await response.json();
      const blob = base64ToAudioBlob(data.audioContent);
      recordUsage('google', text.length);
      return blob;
    },
  };
}

registerProviderMeta({
  id: 'google',
  name: 'Google Cloud TTS',
  tier: 'byok',
  description: 'Generous free tier (1M characters/month), reliable quality.',
  configFields: [
    {
      key: 'apiKey',
      label: 'Google Cloud API Key',
      type: 'password',
      placeholder: 'AIza...',
      help: "Requires a Google Cloud project with billing enabled — the free tier requires a card on file even though it isn't charged unless you exceed it.",
    },
  ],
});

registerTTSProviderFactory('google', (config) => createGoogleProvider(config.apiKey));
