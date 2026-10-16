import { openSheet } from '../utils/sheet.js';

const SEEN_KEY = 'welcome-seen';
const LIBRIVOX_URL = 'https://librivox.org';

// Used only when localStorage is unavailable, so the screen shows once per
// session instead of on every launch.
let seenThisSession = false;

/** @returns {boolean} */
function hasSeenWelcome() {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return seenThisSession;
  }
}

function markWelcomeSeen() {
  seenThisSession = true;
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Storage blocked: the session flag above is all we can keep.
  }
}

/** Show the welcome screen on the first launch only. */
export function maybeShowWelcome() {
  if (!hasSeenWelcome()) openWelcome({ opener: null });
}

/**
 * The welcome / "How this app works" screen: a large sheet. Closing it any way
 * (Get started, Add books, Escape, backdrop) counts as seen.
 *
 * @param {{ opener?: Element|null }} [options]
 * @returns {{ close: () => void }}
 */
export function openWelcome({ opener = document.activeElement } = {}) {
  // Only offer "Add books" when the library's file input is on screen to reuse.
  const importInput = document.getElementById('import-input');
  let addBooks = false;

  const sheet = openSheet({
    label: 'How this app works',
    className: 'welcome-sheet',
    opener,
    onClose: () => {
      markWelcomeSeen();
      if (addBooks) importInput?.click();
    },
  });
  const { panel } = sheet;

  panel.innerHTML = `
    <div class="ns-grab" aria-hidden="true"></div>
    <div class="welcome-body">
      <h2 class="welcome-title">Welcome to your audiobook shelf</h2>
      <p class="welcome-lead">Play audiobook files, or listen to EPUB books read aloud.</p>

      <section class="welcome-section">
        <h3>Free audiobooks</h3>
        <p><a href="${LIBRIVOX_URL}" target="_blank" rel="noopener">LibriVox</a> has free public-domain audiobooks read by volunteers. Download a book's MP3 or M4B files, then tap Add books to put them in your library. They play like any audiobook, including with the screen locked or while you use other apps.</p>
      </section>

      <section class="welcome-section">
        <h3>Experimental: EPUB read-aloud</h3>
        <p>The app can read an EPUB aloud with your device's built-in voice. That voice stops when you lock your phone or leave the app.</p>
      </section>

      <section class="welcome-section">
        <h3>Your files</h3>
        <p>Books you add stay on this device, saved in your browser. There is no account.</p>
      </section>
    </div>
    <div class="welcome-actions">
      <button type="button" class="primary-btn welcome-btn" data-action="start">Get started</button>
      ${importInput ? '<button type="button" class="welcome-btn welcome-btn--secondary" data-action="add">Add books</button>' : ''}
      <a class="welcome-btn welcome-btn--secondary" href="${LIBRIVOX_URL}" target="_blank" rel="noopener">Browse LibriVox</a>
    </div>
  `;

  panel.querySelector('[data-action="start"]').addEventListener('click', () => sheet.close());
  panel.querySelector('[data-action="add"]')?.addEventListener('click', () => {
    addBooks = true;
    sheet.close();
  });

  sheet.focus(panel.querySelector('[data-action="start"]'));
  return { close: sheet.close };
}
