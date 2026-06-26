/**
 * Escape a string for safe insertion into HTML content.
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Escape a string for safe insertion into an HTML attribute.
 * @param {string} text
 * @returns {string}
 */
export function escapeAttr(text) {
  return text.replace(/"/g, '&quot;');
}
