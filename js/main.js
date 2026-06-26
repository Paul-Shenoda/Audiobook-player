import { renderLibrary } from './views/library.js';
import { renderMp3Player } from './views/mp3-player.js';
import { renderEpubListen } from './views/epub-listen.js';
import { renderSettings } from './views/settings.js';
import { renderMiniPlayer } from './views/mini-player.js';
import { playbackManager } from './services/playback-manager.js';

/** @type {HTMLElement} */
const app = document.getElementById('app');

/** @type {HTMLElement} */
let miniPlayerEl = document.getElementById('mini-player');
if (!miniPlayerEl) {
  miniPlayerEl = document.createElement('div');
  miniPlayerEl.id = 'mini-player';
  miniPlayerEl.className = 'mini-player-bar';
  document.body.appendChild(miniPlayerEl);
}

/** @type {(() => void)|null} */
let currentCleanup = null;

playbackManager.onStateChange = () => {
  renderMiniPlayer(miniPlayerEl, { onOpenBook: openBook });
};

async function showLibrary() {
  runCleanup({ keepPlayback: true });
  await renderLibrary(app, {
    onOpenBook: openBook,
    onOpenSettings: showSettings,
  });
  renderMiniPlayer(miniPlayerEl, { onOpenBook: openBook });
}

/**
 * @param {import('./storage/library-db.js').Book} book
 */
function openBook(book) {
  if (book.type === 'mp3') {
    showMp3Player(book);
  } else {
    showEpubListen(book);
  }
}

/**
 * @param {import('./storage/library-db.js').Book} book
 */
function showMp3Player(book) {
  runCleanup({ keepPlayback: false });
  playbackManager.setActive(book, 'mp3');
  const view = renderMp3Player(app, book, {
    onBack: showLibrary,
    keepPlaybackOnBack: true,
  });
  currentCleanup = view.cleanup;
  renderMiniPlayer(miniPlayerEl, { onOpenBook: openBook });
}

/**
 * @param {import('./storage/library-db.js').Book} book
 */
async function showEpubListen(book) {
  runCleanup({ keepPlayback: false });
  playbackManager.setActive(book, 'epub');
  const view = await renderEpubListen(app, book, {
    onBack: showLibrary,
    onOpenSettings: showSettings,
    keepPlaybackOnBack: true,
  });
  currentCleanup = view.cleanup;
  renderMiniPlayer(miniPlayerEl, { onOpenBook: openBook });
}

async function showSettings() {
  runCleanup({ keepPlayback: true });
  await renderSettings(app, { onBack: showLibrary });
  renderMiniPlayer(miniPlayerEl, { onOpenBook: openBook });
}

/**
 * @param {{ keepPlayback?: boolean }} options
 */
function runCleanup(options = {}) {
  const { keepPlayback = false } = options;
  if (currentCleanup) {
    currentCleanup({ keepPlayback });
    currentCleanup = null;
  }
  if (!keepPlayback) {
    playbackManager.clear();
  }
  renderMiniPlayer(miniPlayerEl, { onOpenBook: openBook });
}

showLibrary();
