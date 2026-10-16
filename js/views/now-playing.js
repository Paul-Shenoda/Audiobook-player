import { playerStore } from '../services/player-store.js';
import { addBookmark } from '../services/bookmarks.js';
import { openChaptersSheet } from './chapters-sheet.js';
import { openSheet } from '../utils/sheet.js';
import { icon } from '../utils/icons.js';
import { escapeHtml } from '../utils/escape-html.js';
import { formatTime } from '../utils/format-time.js';
import { SPEED_STEPS, EPUB_MAX_SPEED } from '../utils/playback-speed.js';
import { renderCoverMarkup, getBookCoverUrl, ensureCoverUrl } from '../utils/cover-art.js';
import { unlockMediaForAutoplay } from '../utils/audio-unlock.js';
import { showToast } from '../utils/toast.js';
import { sharedTtsRouter } from '../tts/tts-router.js';

/**
 * @typedef {import('../storage/library-db.js').Book} Book
 * @typedef {import('../services/player-store.js').PlayerState} PlayerState
 */

/** Titles longer than this get a smaller font so two lines are enough. */
const LONG_TITLE_CHARS = 40;
const SKIP_BACK_S = 15;
const SKIP_FORWARD_S = 30;
const KEY_SEEK_S = 10;
const READ_ALONG_KEY = 'read-along-open';
const SLEEP_CYCLE = ['off', '15', '30', 'chapter'];
const SLEEP_LABELS = { off: 'Sleep off', 15: '15 min', 30: '30 min', chapter: 'End of chapter' };

/** "8 minutes 12 seconds", for screen readers. */
function spokenTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m} minute${m === 1 ? '' : 's'} ${s} second${s === 1 ? '' : 's'}`;
}

/**
 * "about 14 h left" / "about 25 min left", or null when the length of the rest
 * of the book is not known (every later chapter needs a duration).
 * @param {PlayerState} s
 */
function timeLeftText(s) {
  if (!(s.chapterDuration > 0)) return null;
  let seconds = Math.max(0, s.chapterDuration - s.chapterElapsed);
  for (let i = s.chapterIndex + 1; i < s.chapters.length; i += 1) {
    const d = s.chapters[i].duration;
    if (!Number.isFinite(d)) return null;
    seconds += d;
  }
  // Chapter times of an EPUB are already estimated at the current speed.
  if (s.kind === 'audio') seconds /= s.rate || 1;
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return 'less than a minute left';
  return minutes >= 90 ? `about ${Math.round(minutes / 60)} h left` : `about ${minutes} min left`;
}

/**
 * The Now playing screen for audio books and EPUBs. It draws what the player
 * store says and sends commands back; playback itself lives in the engines.
 *
 * @param {HTMLElement} container
 * @param {Book} book
 * @param {{
 *   onClose: () => void,
 *   onOpenSettings?: () => void,
 *   store?: typeof playerStore,
 * }} callbacks
 * @returns {{ cleanup: () => void }}
 */
export function renderNowPlaying(container, book, { onClose, onOpenSettings, store = playerStore }) {
  const isEpub = book.type !== 'mp3';
  let readAlongOpen = false;
  try {
    readAlongOpen = isEpub && localStorage.getItem(READ_ALONG_KEY) === '1';
  } catch {
    // Storage unavailable: start with the cover.
  }

  container.innerHTML = `
    <div class="np">
      <div class="np-glow" aria-hidden="true"></div>
      <header class="np-header">
        <button type="button" class="np-icon-btn" id="np-close" aria-label="Close player">${icon('chevronDown', 24)}</button>
        <p class="np-chapter" id="np-chapter"></p>
        <button type="button" class="np-icon-btn" id="np-more" aria-label="More options" aria-haspopup="dialog">${icon('moreHorizontal', 22)}</button>
      </header>

      <div class="np-stage">
        <div class="np-cover" id="np-cover">${renderCoverMarkup(book, 'np-cover-img')}</div>
        <div class="np-readalong" id="np-readalong" hidden>
          <p class="np-readalong-hint">Read along, following the narrator</p>
          <div class="np-readalong-text" id="np-readalong-text"></div>
        </div>
      </div>

      <div class="np-meta">
        <div class="np-meta-text">
          <h1 class="np-title${book.title.length > LONG_TITLE_CHARS ? ' np-title--long' : ''}" title="${escapeHtml(book.title)}">${escapeHtml(book.title)}</h1>
          <p class="np-author" id="np-author"></p>
          <p class="np-status" id="np-status" role="status"></p>
        </div>
        <button type="button" class="np-bookmark" id="np-bookmark" aria-label="Add bookmark here">${icon('bookmarkAdd', 20)}</button>
      </div>

      <div class="np-progress">
        <div class="np-scrub" id="np-scrub" role="slider" tabindex="0" aria-label="Position in chapter" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">
          <div class="np-scrub-track"><div class="np-scrub-fill" id="np-scrub-fill"></div></div>
          <span class="np-scrub-thumb" id="np-scrub-thumb"></span>
        </div>
        <div class="np-times"><span id="np-elapsed">0:00</span><span id="np-remaining">&minus;0:00</span></div>
        <div class="np-book">
          <div class="np-ticks" aria-hidden="true"><div class="np-ticks-fill" id="np-ticks-fill"></div></div>
          <span id="np-book-text">0% of book</span>
        </div>
      </div>

      <div class="np-transport">
        <button type="button" class="np-skip np-skip--small" id="np-prev" aria-label="Previous chapter">${icon('prevChapter', 26)}</button>
        <button type="button" class="np-skip" id="np-back" aria-label="Back ${SKIP_BACK_S} seconds">${icon('back15', 34)}</button>
        <button type="button" class="np-play" id="np-play" aria-label="Play">${icon('play', 32)}</button>
        <button type="button" class="np-skip" id="np-forward" aria-label="Forward ${SKIP_FORWARD_S} seconds">${icon('forward30', 34)}</button>
        <button type="button" class="np-skip np-skip--small" id="np-next" aria-label="Next chapter">${icon('nextChapter', 26)}</button>
      </div>

      <div class="np-tiles${isEpub ? '' : ' np-tiles--three'}">
        <button type="button" class="np-tile" id="np-speed"><span class="np-tile-value" id="np-speed-value"></span><span class="np-tile-label">Speed</span></button>
        <button type="button" class="np-tile" id="np-sleep">${icon('sleep', 20)}<span class="np-tile-label" id="np-sleep-label"></span></button>
        <button type="button" class="np-tile" id="np-chapters">${icon('chapters', 20)}<span class="np-tile-label">Chapters</span></button>
        <button type="button" class="np-tile" id="np-readalong-btn" aria-pressed="false" ${isEpub ? '' : 'hidden'}>${icon('readAlong', 20)}<span class="np-tile-label">Read along</span></button>
      </div>
    </div>
  `;

  const $ = id => container.querySelector(`#${id}`);
  const root = container.querySelector('.np');
  const playBtn = $('np-play');
  const scrub = $('np-scrub');
  const readAlongPanel = $('np-readalong');
  const readAlongText = $('np-readalong-text');

  /** @type {PlayerState} */
  let state = store.getState();
  let renderedChunks = null;
  let dragFraction = null;
  let shownError = null;
  let activeSheet = null;
  let gone = false;

  store.open(book);

  // ---- Cover (a generated cover arrives a moment later for books without art) ----

  if (!getBookCoverUrl(book)) {
    ensureCoverUrl(book).then(() => {
      const url = getBookCoverUrl(book);
      if (gone || !url) return;
      $('np-cover').innerHTML = `<img src="${url}" alt="" class="np-cover-img">`;
    });
  }

  // ---- Drawing the store's state ----

  function narratorLine() {
    // The built-in voice is only named when no AI provider is narrating.
    return isEpub && !sharedTtsRouter.aiProvider && book.author
      ? `${book.author}, read by on-device voice`
      : book.author || '';
  }

  function statusLine(s) {
    if (s.status === 'loading') return 'Loading…';
    if (s.status === 'error') return `Could not play: ${s.error ?? 'unknown error'}`;
    return s.error ?? '';
  }

  function setPosition(fraction, elapsed, duration) {
    const pct = `${Math.min(100, Math.max(0, fraction * 100))}%`;
    $('np-scrub-fill').style.width = pct;
    $('np-scrub-thumb').style.left = `calc(${pct} - 8px)`;
    $('np-elapsed').textContent = formatTime(elapsed);
    $('np-remaining').textContent = `−${formatTime(Math.max(0, duration - elapsed))}`;
  }

  function render(s) {
    if (s.book?.id !== book.id) return;
    const previous = state;
    state = s;

    $('np-chapter').textContent = s.chapters.length > 1 ? `Chapter ${s.chapterIndex + 1} of ${s.chapters.length}` : '';
    $('np-author').textContent = narratorLine();
    const status = statusLine(s);
    $('np-status').textContent = status;
    $('np-status').classList.toggle('np-status--error', s.status === 'error' || Boolean(s.error));
    if (s.error && s.error !== shownError) showToast(status, 'error', 6000);
    shownError = s.error;

    const playing = s.status === 'playing';
    playBtn.innerHTML = icon(playing ? 'pause' : 'play', 32);
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    playBtn.disabled = s.status === 'loading' || s.status === 'error';

    $('np-prev').disabled = s.chapterIndex <= 0;
    $('np-next').disabled = s.chapterIndex >= s.chapters.length - 1;

    // While the finger is down the scrubber follows it, not the engine.
    const duration = s.chapterDuration;
    if (dragFraction == null) {
      setPosition(duration > 0 ? s.chapterElapsed / duration : 0, s.chapterElapsed, duration);
    }
    scrub.setAttribute('aria-valuemax', String(Math.round(duration)));
    scrub.setAttribute('aria-valuenow', String(Math.round(s.chapterElapsed)));
    scrub.setAttribute('aria-valuetext', `${spokenTime(s.chapterElapsed)} of ${spokenTime(duration)}`);

    const percent = Math.round(s.bookPercent);
    $('np-ticks-fill').style.width = `${percent}%`;
    const left = timeLeftText(s);
    $('np-book-text').textContent = left ? `${percent}% of book, ${left}` : `${percent}% of book`;

    $('np-speed-value').textContent = `${s.rate}×`;
    $('np-speed').setAttribute('aria-label', `Playback speed ${s.rate}×, change`);

    const mode = s.sleep?.mode ?? 'off';
    $('np-sleep-label').textContent = SLEEP_LABELS[mode];
    $('np-sleep').setAttribute('aria-label', `Sleep timer ${SLEEP_LABELS[mode]}, change`);
    $('np-sleep').classList.toggle('np-tile--on', mode !== 'off');

    if (s.readAlong && s.readAlong.chunks !== renderedChunks) {
      buildReadAlong(s.readAlong.chunks);
      highlightChunk(s.readAlong.chunkIndex);
    } else if (s.readAlong && s.readAlong.chunkIndex !== previous.readAlong?.chunkIndex) {
      highlightChunk(s.readAlong.chunkIndex);
    }
  }

  // ---- Read along ----

  function applyReadAlong() {
    root.classList.toggle('np--reading', readAlongOpen);
    readAlongPanel.hidden = !readAlongOpen;
    $('np-cover').hidden = readAlongOpen;
    $('np-readalong-btn').setAttribute('aria-pressed', String(readAlongOpen));
    $('np-readalong-btn').classList.toggle('np-tile--on', readAlongOpen);
    if (readAlongOpen) highlightChunk(state.readAlong?.chunkIndex ?? 0);
  }

  function buildReadAlong(chunks) {
    renderedChunks = chunks;
    readAlongText.innerHTML = chunks
      .map((c, i) => `<span class="np-chunk" role="button" tabindex="0" data-chunk="${i}">${escapeHtml(c)} </span>`)
      .join('');
  }

  function highlightChunk(index) {
    readAlongText.querySelector('.np-chunk--current')?.classList.remove('np-chunk--current');
    const el = readAlongText.querySelector(`[data-chunk="${index}"]`);
    if (!el) return;
    el.classList.add('np-chunk--current');
    if (readAlongOpen) {
      // Scroll the panel only (scrollIntoView would also move the page).
      readAlongText.scrollTop = el.offsetTop - readAlongText.offsetTop - readAlongText.clientHeight / 2 + el.clientHeight / 2;
    }
  }

  function jumpToChunk(el) {
    const count = state.readAlong?.chunks.length ?? 0;
    if (!el || !count) return;
    unlockMediaForAutoplay();
    store.seekInChapter((Number(el.dataset.chunk) + 0.5) / count);
    store.play();
  }

  readAlongText.addEventListener('click', e => jumpToChunk(e.target.closest('[data-chunk]')));
  readAlongText.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    jumpToChunk(e.target.closest('[data-chunk]'));
  });

  $('np-readalong-btn').addEventListener('click', () => {
    readAlongOpen = !readAlongOpen;
    try {
      localStorage.setItem(READ_ALONG_KEY, readAlongOpen ? '1' : '0');
    } catch {
      // Not remembered; fine.
    }
    applyReadAlong();
  });

  // ---- Scrubber: tap, drag, or arrow keys ----

  function fractionFromPointer(e) {
    const rect = scrub.getBoundingClientRect();
    return rect.width > 0 ? Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) : 0;
  }

  scrub.addEventListener('pointerdown', e => {
    if (!(state.chapterDuration > 0)) return;
    scrub.setPointerCapture?.(e.pointerId);
    dragFraction = fractionFromPointer(e);
    setPosition(dragFraction, dragFraction * state.chapterDuration, state.chapterDuration);
  });
  scrub.addEventListener('pointermove', e => {
    if (dragFraction == null) return;
    dragFraction = fractionFromPointer(e);
    setPosition(dragFraction, dragFraction * state.chapterDuration, state.chapterDuration);
  });
  const endDrag = e => {
    if (dragFraction == null) return;
    const fraction = e.type === 'pointercancel' ? null : fractionFromPointer(e);
    dragFraction = null;
    if (fraction != null) store.seekInChapter(fraction);
    render(store.getState());
  };
  scrub.addEventListener('pointerup', endDrag);
  scrub.addEventListener('pointercancel', endDrag);

  scrub.addEventListener('keydown', e => {
    const { chapterElapsed, chapterDuration } = state;
    if (!(chapterDuration > 0)) return;
    let target = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') target = chapterElapsed - KEY_SEEK_S;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') target = chapterElapsed + KEY_SEEK_S;
    else if (e.key === 'Home') target = 0;
    else if (e.key === 'End') target = chapterDuration;
    if (target == null) return;
    e.preventDefault();
    store.seekInChapter(Math.min(1, Math.max(0, target / chapterDuration)));
  });

  // ---- Buttons ----

  $('np-close').addEventListener('click', () => onClose());

  playBtn.addEventListener('click', () => {
    if (isEpub) unlockMediaForAutoplay();
    store.toggle();
  });
  $('np-back').addEventListener('click', () => store.skip(-SKIP_BACK_S));
  $('np-forward').addEventListener('click', () => store.skip(SKIP_FORWARD_S));
  $('np-prev').addEventListener('click', () => store.prevChapter());
  $('np-next').addEventListener('click', () => store.nextChapter());

  $('np-bookmark').addEventListener('click', () => {
    addBookmark(store.getState().book ?? book, store.getState());
    showToast('Bookmark added', 'success');
  });

  $('np-sleep').addEventListener('click', () => {
    const mode = state.sleep?.mode ?? 'off';
    store.setSleep(SLEEP_CYCLE[(SLEEP_CYCLE.indexOf(mode) + 1) % SLEEP_CYCLE.length]);
  });

  $('np-chapters').addEventListener('click', e => openChapters(e.currentTarget));

  function openChapters(opener, tab) {
    activeSheet = openChaptersSheet({ opener, tab, store, onClose: () => (activeSheet = null) });
  }

  $('np-speed').addEventListener('click', e => {
    const max = isEpub ? EPUB_MAX_SPEED : Infinity;
    const sheet = openSheet({
      label: 'Playback speed',
      className: 'sp-sheet',
      opener: e.currentTarget,
      onClose: () => (activeSheet = null),
    });
    activeSheet = sheet;
    sheet.panel.innerHTML = `
      <div class="ns-grab" aria-hidden="true"></div>
      <div class="ns-sheet-head"><h2 class="ns-sheet-title">Speed</h2>
        <button type="button" class="ns-icon-btn" data-close aria-label="Close">${icon('close', 22)}</button></div>
      <div class="sp-list">${SPEED_STEPS.filter(step => step <= max)
        .map(
          step =>
            `<button type="button" class="sp-option${step === state.rate ? ' sp-option--current' : ''}" data-rate="${step}" aria-pressed="${step === state.rate}">${step}×</button>`,
        )
        .join('')}</div>`;
    sheet.panel.querySelector('[data-close]').addEventListener('click', () => sheet.close());
    sheet.panel.querySelectorAll('[data-rate]').forEach(btn => {
      btn.addEventListener('click', () => {
        store.setRate(Number(btn.dataset.rate));
        sheet.close();
      });
    });
    sheet.focus(sheet.panel.querySelector('.sp-option--current'));
  });

  $('np-more').addEventListener('click', e => {
    const sheet = openSheet({
      label: 'More options',
      className: 'sp-sheet',
      opener: e.currentTarget,
      onClose: () => (activeSheet = null),
    });
    activeSheet = sheet;
    sheet.panel.innerHTML = `
      <div class="ns-grab" aria-hidden="true"></div>
      <div class="sp-list sp-list--menu">
        ${isEpub && onOpenSettings ? `<button type="button" class="sp-option" data-menu="settings">Narration settings</button>` : ''}
        <button type="button" class="sp-option" data-menu="bookmarks">Bookmarks</button>
      </div>`;
    sheet.panel.querySelector('[data-menu="settings"]')?.addEventListener('click', () => {
      sheet.close();
      onOpenSettings();
    });
    sheet.panel.querySelector('[data-menu="bookmarks"]').addEventListener('click', () => {
      const opener = e.currentTarget;
      sheet.close();
      openChapters(opener, 'bookmarks');
    });
    sheet.focus();
  });

  // ---- Start ----

  applyReadAlong();
  render(store.getState());
  const unsubscribe = store.subscribe(render);

  /** Leaves playback alone: closing this screen never stops the book. */
  function cleanup() {
    gone = true;
    unsubscribe();
    activeSheet?.close();
  }

  return { cleanup };
}
