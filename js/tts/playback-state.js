const STORAGE_PREFIX = 'epub-progress:';

/**
 * @typedef {Object} EpubProgress
 * @property {number} chapterIndex
 * @property {number} chunkIndex
 * @property {number} charOffset
 */

/**
 * @param {string} bookId
 * @returns {EpubProgress|null}
 */
export function loadEpubProgress(bookId) {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${bookId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} bookId
 * @param {EpubProgress} progress
 */
export function saveEpubProgress(bookId, progress) {
  localStorage.setItem(`${STORAGE_PREFIX}${bookId}`, JSON.stringify(progress));
}

/**
 * @param {string} bookId
 */
export function clearEpubProgress(bookId) {
  localStorage.removeItem(`${STORAGE_PREFIX}${bookId}`);
}

/**
 * @param {number} chapterIndex
 * @param {number} totalChapters
 * @param {number} chunkIndex
 * @param {number} totalChunks
 * @returns {number} 0-100
 */
export function estimatePercent(chapterIndex, totalChapters, chunkIndex, totalChunks) {
  if (totalChapters <= 0) return 0;
  const chapterWeight = 1 / totalChapters;
  const chunkFraction = totalChunks > 0 ? chunkIndex / totalChunks : 0;
  return Math.min(100, Math.round(((chapterIndex + chunkFraction) * chapterWeight) * 100));
}

// ~150 words/minute average narration pace at 1x, ~5.5 chars per word+space.
const CHARS_PER_SECOND = (150 * 5.5) / 60;

/**
 * Rough remaining-time estimate for the rest of the current chapter, based
 * on character count rather than real audio duration — the free built-in
 * voice has no seekable timeline to measure against, so both TTS providers
 * share this estimate for a consistent chapter-progress display.
 * @param {string[]} chunks
 * @param {number} chunkIndex
 * @param {number} [rate]
 * @returns {number} seconds
 */
export function estimateSecondsRemaining(chunks, chunkIndex, rate = 1) {
  const remainingChars = chunks
    .slice(chunkIndex)
    .reduce((sum, c) => sum + c.length, 0);
  return remainingChars / CHARS_PER_SECOND / Math.max(rate, 0.1);
}
