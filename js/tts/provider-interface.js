/**
 * @typedef {Object} TTSVoice
 * @property {string} id
 * @property {string} name
 * @property {string} [previewUrl]
 */

/**
 * @typedef {Object} TTSProvider
 * @property {string} id
 * @property {string} name
 * @property {() => Promise<TTSVoice[]>} listVoices
 * @property {(text: string, voiceId: string, options?: { rate?: number }) => Promise<Blob>} synthesize
 * @property {(chars: number) => number} [estimateCost]
 */

/**
 * @param {TTSProvider} provider
 * @returns {boolean}
 */
export function isTTSProvider(provider) {
  return (
    provider &&
    typeof provider.id === 'string' &&
    typeof provider.synthesize === 'function' &&
    typeof provider.listVoices === 'function'
  );
}
