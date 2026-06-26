import { playbackManager } from '../services/playback-manager.js';
import { icon } from '../utils/icons.js';
import { escapeHtml } from '../utils/escape-html.js';
import {
  getBookCoverUrl,
  ensureFallbackCoverUrl,
} from '../utils/cover-art.js';

/**
 * @param {HTMLElement} container
 * @param {{ onOpenBook: (book: import('../storage/library-db.js').Book) => void }} callbacks
 */
export function renderMiniPlayer(container, { onOpenBook }) {
  const { book, type, isPlaying, isPaused } = playbackManager;
  if (!book) {
    container.innerHTML = '';
    container.classList.remove('mini-player-bar--visible');
    return;
  }

  container.classList.add('mini-player-bar--visible');
  const coverUrl = getBookCoverUrl(book);
  const showPause = isPlaying && !isPaused;

  container.innerHTML = `
    <div class="mini-player-inner">
      <button class="mini-player-open" id="mini-open" type="button">
        ${coverUrl ? `<img src="${coverUrl}" alt="" class="mini-cover">` : '<div class="mini-cover mini-cover--ph"></div>'}
        <div class="mini-info">
          <p class="mini-title">${escapeHtml(book.title)}</p>
          <p class="mini-sub">${type === 'mp3' ? 'Audiobook' : 'EPUB listen'}</p>
        </div>
      </button>
      <button class="mini-play-btn icon-btn-touch" id="mini-play" type="button" aria-label="${showPause ? 'Pause' : 'Play'}">
        ${showPause ? icon('pause', 28) : icon('play', 28)}
      </button>
    </div>
  `;

  if (!coverUrl) {
    ensureFallbackCoverUrl(book).then(() => {
      const img = container.querySelector('.mini-cover--ph');
      const url = getBookCoverUrl(book);
      if (img && url) {
        const image = document.createElement('img');
        image.src = url;
        image.alt = '';
        image.className = 'mini-cover';
        img.replaceWith(image);
      }
    });
  }

  container.querySelector('#mini-open')?.addEventListener('click', () => {
    onOpenBook(book);
  });

  container.querySelector('#mini-play')?.addEventListener('click', () => {
    if (type === 'mp3' && playbackManager.audio) {
      if (playbackManager.audio.paused) {
        playbackManager.audio.play().catch(() => {});
        playbackManager.setPlaying(true);
      } else {
        playbackManager.audio.pause();
        playbackManager.setPaused(true);
      }
    } else if (type === 'epub') {
      if (playbackManager.tts.isPlaying() && !playbackManager.tts.isPaused()) {
        playbackManager.tts.pause();
        playbackManager.setPaused(true);
      } else if (playbackManager.tts.isPaused()) {
        playbackManager.tts.resume();
        playbackManager.setPlaying(true);
      }
    }
    renderMiniPlayer(container, { onOpenBook });
  });
}


