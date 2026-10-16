import { playerStore } from '../services/player-store.js';
import { icon } from '../utils/icons.js';
import {
  getBookCoverUrl,
  ensureFallbackCoverUrl,
} from '../utils/cover-art.js';

/**
 * Show the mini player bar for whatever the player store has loaded, and keep
 * it in step with the store. It never decides play/pause itself: the button
 * asks the store to toggle, and the icon follows the status the engine reports.
 *
 * @param {HTMLElement} container
 * @param {{
 *   onOpenBook: (book: import('../storage/library-db.js').Book) => void,
 *   store?: typeof playerStore,
 * }} options
 * @returns {() => void} unmount
 */
export function mountMiniPlayer(container, { onOpenBook, store = playerStore }) {
  // Time ticks arrive several times a second; only rebuild when what we show changes.
  let lastKey = null;

  function render(state) {
    const { book, kind, status } = state;
    const showPause = status === 'playing';
    const key = book ? `${book.id}|${kind}|${showPause}` : '';
    if (key === lastKey) return;
    lastKey = key;

    if (!book) {
      container.innerHTML = '';
      container.classList.remove('mini-player-bar--visible');
      return;
    }

    container.classList.add('mini-player-bar--visible');
    const coverUrl = getBookCoverUrl(book);

    container.innerHTML = `
    <div class="mini-player-inner">
      <button class="mini-player-open" id="mini-open" type="button">
        ${coverUrl ? `<img src="${coverUrl}" alt="" class="mini-cover">` : '<div class="mini-cover mini-cover--ph"></div>'}
        <div class="mini-info">
          <p class="mini-title">${escapeHtml(book.title)}</p>
          <p class="mini-sub">${kind === 'audio' ? 'Audiobook' : 'EPUB listen'}</p>
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

    container.querySelector('#mini-open')?.addEventListener('click', () => onOpenBook(book));
    container.querySelector('#mini-play')?.addEventListener('click', () => store.toggle());
  }

  render(store.getState());
  const unsubscribe = store.subscribe(render);

  return function unmount() {
    unsubscribe();
    lastKey = null;
    container.innerHTML = '';
    container.classList.remove('mini-player-bar--visible');
  };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
