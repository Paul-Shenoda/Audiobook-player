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
 * On phones it is a floating card (cover, title, play, thin progress line).
 * From 1024px the same markup becomes the full-width bottom player bar; CSS
 * reveals the back 15 / forward 30 buttons and the speed label.
 *
 * @param {HTMLElement} container
 * @param {{
 *   onOpenBook: (book: import('../storage/library-db.js').Book) => void,
 *   store?: typeof playerStore,
 * }} options
 * @returns {() => void} unmount
 */
export function mountMiniPlayer(container, { onOpenBook, store = playerStore }) {
  // Time ticks arrive several times a second. The markup is built once per
  // book; each tick only touches the few parts that changed.
  let builtKey = null;

  function build(book) {
    container.classList.add('mini-player-bar--visible');
    const coverUrl = getBookCoverUrl(book);

    container.innerHTML = `
    <div class="mini-player-inner">
      <button class="mini-player-open" id="mini-open" type="button">
        ${coverUrl ? `<img src="${coverUrl}" alt="" class="mini-cover">` : '<div class="mini-cover mini-cover--ph"></div>'}
        <div class="mini-info">
          <p class="mini-title">${escapeHtml(book.title)}</p>
          <p class="mini-sub"></p>
        </div>
      </button>
      <div class="mini-controls">
        <button class="mini-skip-btn icon-btn-touch" id="mini-back" type="button" aria-label="Back 15 seconds">${icon('back15', 26)}</button>
        <button class="mini-play-btn icon-btn-touch" id="mini-play" type="button"></button>
        <button class="mini-skip-btn icon-btn-touch" id="mini-forward" type="button" aria-label="Forward 30 seconds">${icon('forward30', 26)}</button>
        <span class="mini-speed" id="mini-speed"></span>
      </div>
    </div>
    <div class="mini-progress" aria-hidden="true"><div class="mini-progress-fill"></div></div>
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
    container.querySelector('#mini-back')?.addEventListener('click', () => store.skip(-15));
    container.querySelector('#mini-forward')?.addEventListener('click', () => store.skip(30));
  }

  /** @param {import('../services/player-store.js').PlayerState} state */
  function render(state) {
    const { book, kind, status } = state;

    if (!book) {
      builtKey = null;
      container.innerHTML = '';
      container.classList.remove('mini-player-bar--visible');
      return;
    }

    const key = `${book.id}|${kind}`;
    if (key !== builtKey) {
      builtKey = key;
      build(book);
    }

    const showPause = status === 'playing';
    const playBtn = container.querySelector('#mini-play');
    const label = showPause ? 'Pause' : 'Play';
    if (playBtn && playBtn.getAttribute('aria-label') !== label) {
      playBtn.setAttribute('aria-label', label);
      playBtn.innerHTML = showPause ? icon('pause', 24) : icon('play', 24);
    }

    const sub = container.querySelector('.mini-sub');
    const subText = state.chapters?.[state.chapterIndex]?.title
      || (kind === 'audio' ? 'Audiobook' : 'EPUB listen');
    if (sub && sub.textContent !== subText) sub.textContent = subText;

    const speed = container.querySelector('#mini-speed');
    const speedText = `${Number((state.rate || 1).toFixed(2))}×`;
    if (speed && speed.textContent !== speedText) speed.textContent = speedText;

    const fill = /** @type {HTMLElement|null} */ (container.querySelector('.mini-progress-fill'));
    const percent = Math.max(0, Math.min(100, Math.round((state.bookPercent || 0) * 10) / 10));
    if (fill && fill.style.width !== `${percent}%`) fill.style.width = `${percent}%`;
  }

  render(store.getState());
  const unsubscribe = store.subscribe(render);

  return function unmount() {
    unsubscribe();
    builtKey = null;
    container.innerHTML = '';
    container.classList.remove('mini-player-bar--visible');
  };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
