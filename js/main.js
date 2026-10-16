import { registerSW } from 'virtual:pwa-register';
import { renderLibrary } from './views/library.js';
import { showToast } from './utils/toast.js';
import { renderNowPlaying } from './views/now-playing.js';
import { renderSettings } from './views/settings.js';
import { mountMiniPlayer } from './views/mini-player.js';
import { playerStore } from './services/player-store.js';
import { createAudioEngine } from './engines/audio-engine.js';
import { createTtsEngine } from './engines/tts-engine.js';
import { bridgeMediaSession } from './services/media-session-bridge.js';
import { createViewLifecycle } from './services/view-lifecycle.js';
import { maybeShowWelcome } from './views/welcome.js';
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

// Tell iOS this is a media player (Safari 16.4+ Audio Session API), so audio
// keeps playing in the background and on the lock screen instead of being
// treated as ambient sound that stops when the app is left.
if ('audioSession' in navigator) {
  try {
    navigator.audioSession.type = 'playback';
  } catch {
    // Unsupported type on this browser: keep the default behaviour.
  }
}

// Cleans up views, including a player still playing in the background.
const lifecycle = createViewLifecycle({ clearPlayback: () => playerStore.close() });

// One engine per open book: audio files play through <audio>, EPUBs through TTS.
playerStore.setEngineFactory((kind) => (kind === 'audio' ? createAudioEngine() : createTtsEngine()));

// Lock-screen controls follow the store too, not any one view.
bridgeMediaSession(playerStore);

// The mini player follows the store by itself; no view needs to redraw it.
mountMiniPlayer(miniPlayerEl, { onOpenBook: openBook });

async function showLibrary() {
  runCleanup({ keepPlayback: true });
  await renderLibrary(app, {
    onOpenBook: openBook,
    onOpenSettings: showSettings,
  });
}

/**
 * @param {import('./storage/library-db.js').Book} book
 */
async function openBook(book) {
  // Already on screen (e.g. tapping the mini player for the open book): keep it.
  // Rebuilding the EPUB reader here hit Safari's stale IndexedDB Blob error.
  if (lifecycle.isShowing(book.id)) return;
  // The mini player holds the book from when it was first opened, so read the
  // current record (speed, position, bookmarks). It carries no file Blobs;
  // engines read those fresh from the database.
  const current = (await getBook(book.id).catch(() => null)) ?? book;
  showNowPlaying(current);
}

/**
 * One Now playing screen for both audio books and EPUBs.
 * @param {import('./storage/library-db.js').Book} book
 */
function showNowPlaying(book) {
  // The book is already loaded (e.g. reopened from the mini player): keep it
  // playing and just draw the screen again. Any other book replaces it.
  runCleanup({ keepPlayback: playerStore.getState().book?.id === book.id });
  const view = renderNowPlaying(app, book, {
    onClose: showLibrary,
    onOpenSettings: showSettings,
  });
  lifecycle.show(view.cleanup, book.id);
}

async function showSettings() {
  runCleanup({ keepPlayback: true });
  await renderSettings(app, { onBack: showLibrary });
}

/**
 * @param {{ keepPlayback?: boolean }} options
 */
function runCleanup(options = {}) {
  lifecycle.leave(options);
}

showLibrary();
maybeShowWelcome();

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
