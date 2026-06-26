/**
 * Strip HTML to plain text, preserving paragraph breaks.
 * @param {string} html
 * @returns {string}
 */
export function htmlToPlainText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blockTags = new Set([
    'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'LI', 'BR', 'SECTION', 'ARTICLE', 'BLOCKQUOTE',
  ]);

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent.replace(/\s+/g, ' ');
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const tag = node.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE') {
      return '';
    }

    let text = '';
    for (const child of node.childNodes) {
      text += walk(child);
    }

    if (blockTags.has(tag)) {
      return `${text.trim()}\n\n`;
    }

    return text;
  }

  return walk(doc.body)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Split text into sentence-bounded chunks for TTS.
 * @param {string} text
 * @param {number} maxChars
 * @returns {string[]}
 */
export function chunkText(text, maxChars = 2000) {
  if (!text) return [];

  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    if ((current + ' ' + trimmed).trim().length > maxChars && current) {
      chunks.push(current.trim());
      current = trimmed;
    } else {
      current = current ? `${current} ${trimmed}` : trimmed;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}
