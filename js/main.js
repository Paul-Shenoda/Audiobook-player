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

/**
 * Navigate to a view, handling cleanup and mini-player refresh.
 * @param {{ keepPlayback: boolean }} cleanupOpts
 * @param {() => (Promise<{ cleanup?: Function }|void>|{ cleanup?: Function }|void)} renderFn
 */
async function navigateTo(cleanupOpts, renderFn) {
  runCleanup(cleanupOpts);
  const view = await renderFn();
  currentCleanup = view?.cleanup ?? null;
  renderMiniPlayer(miniPlayerEl, { onOpenBook: openBook });
}

async function showLibrary() {
  await navigateTo({ keepPlayback: true }, () =>
    renderLibrary(app, {
      onOpenBook: openBook,
      onOpenSettings: showSettings,
    }),
  );
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
  navigateTo({ keepPlayback: false }, () => {
    playbackManager.setActive(book, 'mp3');
    return renderMp3Player(app, book, {
      onBack: showLibrary,
      keepPlaybackOnBack: true,
    });
  });
}

/**
 * @param {import('./storage/library-db.js').Book} book
 */
async function showEpubListen(book) {
  await navigateTo({ keepPlayback: false }, async () => {
    playbackManager.setActive(book, 'epub');
    return renderEpubListen(app, book, {
      onBack: showLibrary,
      onOpenSettings: showSettings,
      keepPlaybackOnBack: true,
    });
  });
}

async function showSettings() {
  await navigateTo({ keepPlayback: true }, () =>
    renderSettings(app, { onBack: showLibrary }),
  );
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
}

showLibrary();
