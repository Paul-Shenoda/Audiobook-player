/**
 * Format seconds into MM:SS string.
 * @param {number} seconds
 * @returns {string}
 */
function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatTime };
}
