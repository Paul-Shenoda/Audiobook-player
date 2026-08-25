/**
 * @typedef {Object} TTSVoice
 * @property {string} id
 * @property {string} name
 * @property {string} [previewUrl]
 */

/**
 * A single credential/config input the Settings screen renders for a
 * provider — e.g. an API key field. Rendered dynamically so adding a new
 * BYOK provider never requires editing the Settings form by hand.
 * @typedef {Object} TTSConfigField
 * @property {string} key required — maps to a key on the saved TTSSettings object
 * @property {string} label
 * @property {'text'|'password'} type
 * @property {string} [placeholder]
 * @property {string} [help] short helper text shown under the field
 */

/**
 * @typedef {Object} TTSProvider
 * @property {string} id
 * @property {string} name
 * @property {'free'|'byok'} tier 'free' groups under "Free & Offline" in
 *   Settings; 'byok' groups under "Bring Your Own Key" and renders configFields
 * @property {string} [description] one-line blurb shown in the provider list
 * @property {string} [limitations] short caveat note shown under the option
 *   (e.g. download size, quality tradeoffs) — required for any 'free' provider
 *   that isn't simply "always been there" (i.e. anything beyond web-speech)
 * @property {TTSConfigField[]} [configFields] omitted/empty for 'free' providers
 * @property {boolean} [requiresProxy] true if browser CORS/request-signing
 *   makes a direct fetch impractical without the user running their own proxy
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

/**
 * Metadata shown in the Settings screen's provider list — a subset of
 * TTSProvider that doesn't require actually constructing the provider.
 * @typedef {Object} TTSProviderMeta
 * @property {string} id
 * @property {string} name
 * @property {'free'|'byok'} tier
 * @property {string} [description]
 * @property {string} [limitations]
 * @property {TTSConfigField[]} [configFields]
 * @property {boolean} [requiresProxy]
 */

/** @type {Map<string, TTSProviderMeta>} */
const catalog = new Map();

/**
 * Register a provider's metadata for the Settings screen to list. Each
 * provider module calls this once, at module load time (a side effect of
 * being imported), so Settings never needs per-provider hardcoding.
 * @param {TTSProviderMeta} meta
 */
export function registerProviderMeta(meta) {
  catalog.set(meta.id, meta);
}

/** @returns {TTSProviderMeta[]} */
export function listProviderCatalog() {
  return Array.from(catalog.values());
}

/** @type {Map<string, (settings: import('./tts-router.js').TTSSettings) => TTSProvider>} */
const factories = new Map();

/**
 * Register a factory that builds a working provider instance for one
 * provider id. Called once per provider module at load time, alongside
 * registerProviderMeta. Not needed for 'web-speech', which TTSRouter
 * constructs directly since its playback path (browser utterances, no
 * audio Blob) is fundamentally different from every other provider.
 * @param {string} id
 * @param {(settings: import('./tts-router.js').TTSSettings) => TTSProvider} factory
 */
export function registerTTSProviderFactory(id, factory) {
  factories.set(id, factory);
}

/**
 * @param {string} id
 * @returns {((settings: import('./tts-router.js').TTSSettings) => TTSProvider)|undefined}
 */
export function getProviderFactory(id) {
  return factories.get(id);
}

/**
 * Thrown by a provider's synthesize() specifically when it detects free-tier
 * quota exhaustion (as opposed to a bad key, a bad request, or a network
 * failure) — the one condition TTSRouter treats as "silently try the next
 * provider in the chain" rather than surfacing an error to the user. Each
 * provider is responsible for recognizing its own quota signal (they all
 * differ — see each provider file) and throwing this instead of a plain
 * Error when that's what happened.
 */
export class TTSQuotaExceededError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TTSQuotaExceededError';
  }
}
