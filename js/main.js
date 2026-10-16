import { registerSW } from 'virtual:pwa-register';
import { renderLibrary } from './views/library.js';
import { showToast } from './utils/toast.js';
import { renderMp3Player } from './views/mp3-player.js';
import { renderEpubListen } from './views/epub-listen.js';
import { renderSettings } from './views/settings.js';
import { renderMiniPlayer } from './views/mini-player.js';
import { playbackManager } from './services/playback-manager.js';
import { createViewLifecycle } from './services/view-lifecycle.js';
import { getBook } from './storage/library-db.js';

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

// Cleans up views, including a player still playing in the background.
const lifecycle = createViewLifecycle({ clearPlayback: () => playbackManager.clear() });

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
async function openBook(book) {
  // Already on screen (e.g. tapping the mini player for the open book): keep it.
  // Rebuilding the EPUB reader here hit Safari's stale IndexedDB Blob error.
  if (lifecycle.isShowing(book.id)) return;
  // The mini player holds the object from when the book was first opened, so
  // refresh its speed and position from the database. Keep the original file
  // Blob(s): a Blob read now can be stale by the time Safari reads it.
  const saved = await getBook(book.id).catch(() => null);
  const current = saved ? { ...book, progress: saved.progress, playbackRate: saved.playbackRate } : book;
  if (current.type === 'mp3') {
    showMp3Player(current);
  } else {
    showEpubListen(current);
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
  lifecycle.show(view.cleanup, book.id);
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
  lifecycle.show(view.cleanup, book.id);
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
  lifecycle.leave(options);
  renderMiniPlayer(miniPlayerEl, { onOpenBook: openBook });
}

showLibrary();

const updateSW = registerSW({
  onOfflineReady() {
    showToast('App ready to work offline', 'success');
  },
  onNeedRefresh() {
    showToast('A new version is available', 'info', 15000, {
      label: 'Refresh',
      onClick: () => updateSW(true),
    });
  },
});
