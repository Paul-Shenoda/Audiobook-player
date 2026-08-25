/**
 * Tracks estimated monthly character usage per provider in localStorage.
 *
 * Some providers (e.g. Google Cloud TTS) don't error at all once a free
 * monthly quota is exceeded — they just start billing the user's card
 * silently. For those, waiting for an API error isn't good enough; a
 * provider needs to proactively check its own known free-tier budget
 * before making the call. This is a best-effort client-side estimate
 * (character counts, not exact provider-side billing units), not a
 * substitute for the provider's own dashboard.
 */

const KEY_PREFIX = 'tts-usage:';

function monthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}`;
}

/**
 * @param {string} providerId
 * @returns {number} characters used so far this calendar month
 */
export function getMonthlyUsage(providerId) {
  try {
    const raw = localStorage.getItem(`${KEY_PREFIX}${providerId}:${monthKey()}`);
    return raw ? Number(raw) : 0;
  } catch {
    return 0;
  }
}

/**
 * @param {string} providerId
 * @param {number} chars
 */
export function recordUsage(providerId, chars) {
  try {
    const used = getMonthlyUsage(providerId) + chars;
    localStorage.setItem(`${KEY_PREFIX}${providerId}:${monthKey()}`, String(used));
  } catch {
    // Storage unavailable — the provider's own API error handling is the fallback.
  }
}

/**
 * @param {string} providerId
 * @param {number} freeCharBudget monthly character budget for this provider's free tier
 * @param {number} charsAboutToUse
 * @returns {boolean} true if this request would exceed the known free budget
 */
export function wouldExceedBudget(providerId, freeCharBudget, charsAboutToUse) {
  return getMonthlyUsage(providerId) + charsAboutToUse > freeCharBudget;
}
