import jsmediatags from 'jsmediatags';
import { formatTime } from '../utils/format-time.js';
import { createManagedObjectUrl, revokeManagedObjectUrl } from '../utils/object-url.js';
import { updateBook } from '../storage/library-db.js';
import { playbackManager } from '../services/playback-manager.js';
import { icon } from '../utils/icons.js';
import { renderCoverMarkup, getBookCoverUrl } from '../utils/cover-art.js';
import { showToast } from '../utils/toast.js';

/**
 * @typedef {import('../storage/library-db.js').Book} Book
 */

/**
 * @param {HTMLElement} container
 * @param {Book} book
 * @param {{ onBack: () => void, keepPlaybackOnBack?: boolean }} callbacks
 */
export function renderMp3Player(container, book, { onBack, keepPlaybackOnBack = false }) {
  const coverUrl = getBookCoverUrl(book);

  container.innerHTML = `
    <div class="player-view">
      <header class="view-header">
        <button class="back-btn icon-btn-touch" id="back-btn" type="button" aria-label="Back to library">${icon('chevronLeft', 20)} Library</button>
      </header>
      <div class="player-container">
        <div class="player-cover-wrap">
          ${renderCoverMarkup(book, 'player-cover')}
        </div>
        <div class="metadata-section">
          <h2 id="chapter-title" class="player-title">${escapeHtml(book.title)}</h2>
          <p id="author-name" class="player-author">${escapeHtml(book.author)}</p>
        </div>
        <audio id="main-audio"></audio>
        <div class="progress-section">
          <input type="range" id="seek-bar" value="0" min="0" max="100" step="0.1" aria-label="Seek">
          <div class="time-labels">
            <span id="current-time">0:00</span>
            <span id="duration">0:00</span>
          </div>
        </div>
        <div class="controls-section">
          <button class="skip-btn icon-btn-touch" id="rewind-btn" type="button" aria-label="Rewind 15 seconds">${icon('rewind')}<span>15s</span></button>
          <button class="play-btn icon-btn-touch" id="play-pause-btn" type="button" aria-label="Play or pause">${icon('play', 32)}</button>
          <button class="skip-btn icon-btn-touch" id="forward-btn" type="button" aria-label="Forward 15 seconds"><span>15s</span>${icon('forward')}</button>
        </div>
      </div>
    </div>
  `;

  const player = container.querySelector('#main-audio');
  const playBtn = container.querySelector('#play-pause-btn');
  const seekBar = container.querySelector('#seek-bar');
  const currentTimeText = container.querySelector('#current-time');
  const durationText = container.querySelector('#duration');
  const chapterTitle = container.querySelector('#chapter-title');

  playbackManager.audio = player;

  const fileURL = createManagedObjectUrl(book.fileBlob);
  player.src = fileURL;

  if (book.progress?.seconds) {
    player.currentTime = book.progress.seconds;
  }

  jsmediatags.read(book.fileBlob, {
    onSuccess(tag) {
      if (tag.tags.title) {
        chapterTitle.textContent = tag.tags.title;
      }
    },
    onError(error) {
      console.warn('[MP3 Player] Could not read ID3 tags:', error.type, error.info);
    },
  });

  container.querySelector('#back-btn').addEventListener('click', () => {
    saveProgress();
    cleanup({ keepPlayback: keepPlaybackOnBack });
    onBack();
  });

  function setPlayIcon(playing) {
    playBtn.innerHTML = playing ? icon('pause', 32) : icon('play', 32);
  }

  player.addEventListener('error', () => {
    const err = player.error;
    let message = 'Error loading audio';
    if (err) {
      switch (err.code) {
        case MediaError.MEDIA_ERR_ABORTED:
          message = 'Playback aborted';
          break;
        case MediaError.MEDIA_ERR_NETWORK:
          message = 'Network error while loading audio';
          break;
        case MediaError.MEDIA_ERR_DECODE:
          message = 'File could not be decoded';
          break;
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
          message = 'Audio format not supported';
          break;
      }
      console.error('[MP3 Player] Audio error:', err.code, err.message);
    }
    chapterTitle.textContent = message;
    setPlayIcon(false);
    playbackManager.setPaused(true);
    seekBar.value = '0';
    currentTimeText.textContent = '0:00';
    durationText.textContent = '0:00';
    showToast(message, 'error');
  });

  playBtn.addEventListener('click', () => {
    if (player.paused) {
      player.play()
        .then(() => {
          setPlayIcon(true);
          playbackManager.setPlaying(true);
        })
        .catch((err) => {
          console.error('[MP3 Player] Playback failed:', err.message);
          setPlayIcon(false);
          showToast('Playback failed', 'error');
        });
    } else {
      player.pause();
      setPlayIcon(false);
      playbackManager.setPaused(true);
    }
  });

  container.querySelector('#rewind-btn').addEventListener('click', () => {
    if (!player.duration) return;
    player.currentTime = Math.max(0, player.currentTime - 15);
  });

  container.querySelector('#forward-btn').addEventListener('click', () => {
    if (player.duration) {
      player.currentTime = Math.min(player.duration, player.currentTime + 15);
    }
  });

  player.addEventListener('timeupdate', () => {
    if (!player.duration) return;
    seekBar.value = String((player.currentTime / player.duration) * 100);
    currentTimeText.textContent = formatTime(player.currentTime);
    durationText.textContent = formatTime(player.duration);
  });

  seekBar.addEventListener('input', () => {
    if (!player.duration) return;
    player.currentTime = (Number(seekBar.value) / 100) * player.duration;
  });

  player.addEventListener('ended', () => {
    setPlayIcon(false);
    seekBar.value = '0';
    playbackManager.setPaused(true);
  });

  let saveTimer = null;
  function saveProgress() {
    if (!player.duration) return;
    const percent = Math.round((player.currentTime / player.duration) * 100);
    updateBook(book.id, {
      lastOpenedAt: Date.now(),
      progress: { seconds: player.currentTime, percent },
    });
  }

  player.addEventListener('timeupdate', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveProgress, 2000);
  });

  /**
   * @param {{ keepPlayback?: boolean }} options
   */
  function cleanup(options = {}) {
    const { keepPlayback = false } = options;
    clearTimeout(saveTimer);
    saveProgress();
    if (!keepPlayback) {
      player.pause();
      revokeManagedObjectUrl();
      playbackManager.audio = null;
    }
    if (coverUrl && !book.coverBlob) {
      // fallback url managed by cover-art cache
    }
  }

  return { cleanup };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
