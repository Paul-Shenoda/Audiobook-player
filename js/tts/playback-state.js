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
