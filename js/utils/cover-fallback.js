/**
 * Stable hue from a string (0–359).
 * @param {string} text
 */
export function hashHue(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = text.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

/**
 * @param {string} title
 * @returns {string}
 */
export function getInitials(title) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * Generate a square cover image blob from title and author.
 * @param {string} title
 * @param {string} author
 * @param {number} [size=400]
 * @returns {Promise<Blob>}
 */
export function generateFallbackCover(title, author, size = 400) {
  const hue = hashHue(title || author || 'book');
  const initials = getInitials(title || 'Untitled');
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:hsl(${hue},45%,28%)"/>
          <stop offset="100%" style="stop-color:hsl(${(hue + 40) % 360},50%,18%)"/>
        </linearGradient>
      </defs>
      <rect width="${size}" height="${size}" fill="url(#g)"/>
      <text x="50%" y="46%" text-anchor="middle" fill="#f3f4f6" font-family="system-ui,sans-serif" font-size="${size * 0.22}" font-weight="700">${escapeXml(initials)}</text>
      <text x="50%" y="62%" text-anchor="middle" fill="rgba(243,244,246,0.65)" font-family="system-ui,sans-serif" font-size="${size * 0.055}">${escapeXml(truncate(author, 28))}</text>
    </svg>`;

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas not supported'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to generate cover'));
      }, 'image/png');
    };
    img.onerror = () => reject(new Error('Failed to render cover'));
    img.src = url;
  });
}

/**
 * @param {string} text
 * @param {number} max
 */
function truncate(text, max) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * @param {string} text
 */
function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
