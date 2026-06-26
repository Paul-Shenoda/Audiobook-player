/**
 * OpenAI TTS provider (via local proxy).
 * @param {string} proxyUrl
 * @param {string} apiKey
 * @returns {import('./provider-interface.js').TTSProvider}
 */
export function createOpenAIProvider(proxyUrl, apiKey) {
  return {
    id: 'openai',
    name: 'OpenAI TTS',
    async listVoices() {
      return [
        { id: 'alloy', name: 'Alloy' },
        { id: 'echo', name: 'Echo' },
        { id: 'fable', name: 'Fable' },
        { id: 'onyx', name: 'Onyx' },
        { id: 'nova', name: 'Nova' },
        { id: 'shimmer', name: 'Shimmer' },
      ];
    },
    async synthesize(text, voiceId, options = {}) {
      const response = await fetch(proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          text,
          voice: voiceId || 'nova',
          speed: options.rate ?? 1,
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`TTS request failed: ${response.status} ${detail}`);
      }

      return await response.blob();
    },
    estimateCost(chars) {
      return (chars / 1_000_000) * 15;
    },
  };
}
