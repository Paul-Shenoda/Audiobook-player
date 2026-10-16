import { stepSpeed, EPUB_MAX_SPEED } from '../utils/playback-speed.js';
import { loadTTSSettings } from '../tts/tts-router.js';
import { updateBook } from '../storage/library-db.js';
import { playerStore } from '../services/player-store.js';
import { sleepControl, estimateNarrationCost } from '../engines/tts-engine.js';
import { createSleepTimer } from '../services/sleep-timer.js';
import {
  initMediaSession,
  setMediaPlaybackState,
  teardownMediaSession,
} from '../services/media-session.js';
import { icon } from '../utils/icons.js';
import { isIOS } from '../utils/platform.js';
import { renderCoverMarkup } from '../utils/cover-art.js';
import { showToast } from '../utils/toast.js';
import { unlockMediaForAutoplay } from '../utils/audio-unlock.js';

/**
 * @typedef {import('../storage/library-db.js').Book} Book
 * @typedef {import('../services/player-store.js').PlayerState} PlayerState
 */

/**
 * EPUB listen screen. A thin view: it renders whatever the player store says
 * and sends commands back. Playback itself lives in engines/tts-engine.js.
 * @param {HTMLElement} container
 * @param {Book} book
 * @param {{ onBack: () => void, onOpenSettings: () => void, keepPlaybackOnBack?: boolean }} callbacks
 */
export async function renderEpubListen(container, book, { onBack, onOpenSettings, keepPlaybackOnBack = false }) {
  container.innerHTML = `
    <div class="player-view epub-listen-view">
      <header class="view-header">
        <button class="back-btn icon-btn-touch" id="back-btn" type="button" aria-label="Back to library">${icon('chevronLeft', 20)} Library</button>
        <button class="settings-link-btn icon-btn-touch" id="settings-link-btn" type="button" aria-label="TTS settings">${icon('settings')}</button>
      </header>
      <div class="player-container">
        <div class="player-cover-wrap">
          ${renderCoverMarkup(book, 'player-cover')}
        </div>
        <div class="metadata-section">
          <h2 id="epub-title" class="player-title">Loading...</h2>
          <p id="epub-author" class="player-author">--</p>
        </div>
        <div class="chapter-row">
          <button class="chapter-picker-btn" id="chapter-picker-btn" type="button" aria-label="Choose chapter">${icon('list', 18)}<span id="chapter-label">Chapter 1</span></button>
          <span class="book-percent" id="book-percent" aria-label="Book progress">0%</span>
          <button class="chapter-picker-btn" id="text-toggle-btn" type="button" aria-label="Show or hide text">${icon('text', 18)}<span>Text</span></button>
        </div>
        <div class="read-along" id="read-along-panel" hidden></div>
        <div class="epub-progress-section">
          <div class="progress-bar-track" id="progress-bar-track">
            <div class="progress-bar-fill" id="listen-progress" style="width: 0%"></div>
          </div>
          <span class="time-left-label" id="time-left-label">-- min left</span>
        </div>
        <div class="controls-section">
          <button class="chapter-btn icon-btn-touch" id="skip-back-btn" type="button" aria-label="Skip back">${icon('rewind')}<span>Back</span></button>
          <button class="play-btn listen-btn icon-btn-touch" id="listen-pause-btn" type="button" aria-label="Play or pause">${icon('play', 28)}<span>Listen</span></button>
          <button class="chapter-btn icon-btn-touch" id="skip-forward-btn" type="button" aria-label="Skip forward">${icon('forward')}<span>Next</span></button>
        </div>
        <div class="secondary-controls">
          <div class="speed-control">
            <button class="speed-step-btn icon-btn-touch" id="speed-down-btn" type="button" aria-label="Decrease speed">−</button>
            <span class="speed-label" id="speed-label" aria-live="polite"></span>
            <button class="speed-step-btn icon-btn-touch" id="speed-up-btn" type="button" aria-label="Increase speed">+</button>
          </div>
          <span class="secondary-controls-divider" aria-hidden="true"></span>
          <button class="sleep-btn" id="sleep-btn" type="button" aria-label="Sleep timer">${icon('moon', 18)}<span id="sleep-label">Sleep: Off</span></button>
          <button class="sleep-btn" id="bookmarks-btn" type="button" aria-label="Bookmarks">${icon('bookmark', 18)}<span>Bookmarks</span></button>
          <span class="secondary-controls-divider" aria-hidden="true"></span>
          <button class="stop-btn" id="stop-btn" type="button">Stop</button>
        </div>
        <p class="status-text" id="status-text"></p>
      </div>
    </div>
  `;


  const titleEl = container.querySelector('#epub-title');
  const authorEl = container.querySelector('#epub-author');
  const chapterLabel = container.querySelector('#chapter-label');
  const progressFill = container.querySelector('#listen-progress');
  const progressTrack = container.querySelector('#progress-bar-track');
  const timeLeftLabel = container.querySelector('#time-left-label');
  const bookPercentEl = container.querySelector('#book-percent');
  const statusText = container.querySelector('#status-text');
  const listenBtn = container.querySelector('#listen-pause-btn');
  const speedLabel = container.querySelector('#speed-label');
  const readAlongPanel = container.querySelector('#read-along-panel');
  const textToggleBtn = container.querySelector('#text-toggle-btn');

  titleEl.textContent = book.title;
  authorEl.textContent = book.author || '';

  /** @type {PlayerState} */
  let state = playerStore.getState();
  let bookmarks = book.bookmarks ?? [];
  let hasStarted = false;
  let shownError = null;
  /** The chunk array the read-along panel was last built from. */
  let renderedChunks = null;
  /** Runs after every state change until it clears itself (seek once a chapter has loaded). */
  let pendingSeek = null;

  maybeShowIOSWebSpeechHint(loadTTSSettings());

  // ---- Read-along text ----

  const READ_ALONG_KEY = 'read-along-open';
  let readAlongOpen = localStorage.getItem(READ_ALONG_KEY) === '1';

  function applyReadAlongVisibility() {
    readAlongPanel.hidden = !readAlongOpen;
    textToggleBtn.classList.toggle('chapter-picker-btn--active', readAlongOpen);
    container.querySelector('.player-view')?.classList.toggle('reading-text', readAlongOpen);
    highlightChunk(state.readAlong?.chunkIndex ?? 0);
  }

  textToggleBtn.addEventListener('click', () => {
    readAlongOpen = !readAlongOpen;
    localStorage.setItem(READ_ALONG_KEY, readAlongOpen ? '1' : '0');
    applyReadAlongVisibility();
  });

  function renderReadAlong(chunks) {
    renderedChunks = chunks;
    readAlongPanel.innerHTML = chunks
      .map((c, i) => `<p data-chunk-index="${i}">${escapeHtml(c)}</p>`)
      .join('');
    readAlongPanel.querySelectorAll('[data-chunk-index]').forEach((p) => {
      p.addEventListener('click', () => {
        seekToChunk(Number(p.getAttribute('data-chunk-index')));
      });
    });
  }

  function highlightChunk(index) {
    readAlongPanel.querySelector('.chunk-current')?.classList.remove('chunk-current');
    const el = readAlongPanel.querySelector(`[data-chunk-index="${index}"]`);
    if (!el) return;
    el.classList.add('chunk-current');
    if (readAlongOpen) {
      // Scroll within the panel only — scrollIntoView would also jerk the
      // page. The panel is position:relative so offsetTop is panel-relative.
      readAlongPanel.scrollTop =
        el.offsetTop - readAlongPanel.clientHeight / 2 + el.clientHeight / 2;
    }
  }

  /** Jump to a chunk of the current chapter and start reading from it. */
  function seekToChunk(index) {
    const count = state.readAlong?.chunks.length ?? 0;
    if (!count) return;
    unlockMediaForAutoplay();
    playerStore.seekInChapter((index + 0.5) / count);
    playerStore.play();
  }

  // ---- Rendering the store's state ----

  function setListenButton(status) {
    if (status === 'playing') {
      listenBtn.innerHTML = `${icon('pause', 28)}<span>Pause</span>`;
    } else if (hasStarted) {
      listenBtn.innerHTML = `${icon('play', 28)}<span>Resume</span>`;
    } else {
      listenBtn.innerHTML = `${icon('play', 28)}<span>Listen</span>`;
    }
    listenBtn.disabled = status === 'loading' || status === 'error';
  }

  function formatMinutesLeft(seconds) {
    const minutes = Math.round(seconds / 60);
    return minutes < 1 ? '< 1 min left' : `${minutes} min left`;
  }

  function statusMessage(s) {
    if (s.status === 'loading') return 'Loading...';
    if (s.status === 'error') return `Failed to open EPUB: ${s.error}`;
    if (s.error) return s.error;
    if (s.status === 'playing') return 'Reading aloud...';
    const chunks = s.readAlong?.chunks ?? [];
    if (!chunks.length) return 'This chapter has no readable text';
    if (s.sleep?.stopped === 'chapter-end') return 'Sleep timer — stopped at end of chapter';
    if (hasStarted && s.chapterIndex >= s.chapters.length - 1 && s.chapterElapsed >= s.chapterDuration) {
      return 'Book complete';
    }
    let msg = `Ready — ${chunks.length} segment(s)`;
    const cost = estimateNarrationCost(chunks);
    if (cost != null) msg += ` · ≈ ${cost < 0.005 ? '<$0.01' : `$${cost.toFixed(2)}`} AI narration`;
    return msg;
  }

  function render(next) {
    const previous = state;
    state = next;
    if (state.status === 'playing') hasStarted = true;

    chapterLabel.textContent = state.chapters[state.chapterIndex]?.title ?? 'Chapter 1';
    const fraction = state.chapterDuration > 0 ? state.chapterElapsed / state.chapterDuration : 0;
    progressFill.style.width = `${Math.min(100, Math.round(fraction * 100))}%`;
    timeLeftLabel.textContent = formatMinutesLeft(Math.max(0, state.chapterDuration - state.chapterElapsed));
    bookPercentEl.textContent = `${Math.round(state.bookPercent)}%`;

    speedLabel.textContent = `${state.rate}×`;
    container.querySelector('#speed-down-btn').disabled = state.rate === stepSpeed(state.rate, -1, EPUB_MAX_SPEED);
    container.querySelector('#speed-up-btn').disabled = state.rate === stepSpeed(state.rate, +1, EPUB_MAX_SPEED);

    setListenButton(state.status);
    statusText.textContent = statusMessage(state);
    statusText.classList.toggle('error', state.status === 'error' || Boolean(state.error));
    if (state.error && state.error !== shownError) {
      showToast(state.status === 'error' ? statusText.textContent : state.error, 'error', 6000);
    }
    shownError = state.error;

    if (state.readAlong && state.readAlong.chunks !== renderedChunks) {
      renderReadAlong(state.readAlong.chunks);
      highlightChunk(state.readAlong.chunkIndex);
    } else if (state.readAlong && state.readAlong.chunkIndex !== previous.readAlong?.chunkIndex) {
      highlightChunk(state.readAlong.chunkIndex);
    }

    if (state.status !== previous.status) {
      setMediaPlaybackState(state.status === 'playing' ? 'playing' : 'paused');
    }
    // The engine stopped at the end of the chapter, so the sleep timer is spent.
    if (state.sleep?.stopped && state.sleep !== previous.sleep) sleepTimer.reset();
    pendingSeek?.();
  }

  // ---- Sleep timer (the engine reads sleepControl when a chapter ends) ----

  const sleepBtn = container.querySelector('#sleep-btn');
  const sleepLabel = container.querySelector('#sleep-label');
  const sleepTimer = createSleepTimer({
    modes: ['off', '15', '30', '60', 'chapter'],
    onExpire: () => playerStore.pause(),
    onTick: (text) => {
      sleepLabel.textContent = text;
      sleepBtn.classList.toggle('sleep-btn--active', sleepTimer.getMode() !== 'off');
      sleepControl.atChapterEnd = sleepTimer.getMode() === 'chapter';
    },
  });
  sleepBtn.addEventListener('click', () => sleepTimer.cycle());

  // ---- Controls ----

  listenBtn.addEventListener('click', () => {
    unlockMediaForAutoplay();
    playerStore.toggle();
  });

  container.querySelector('#stop-btn').addEventListener('click', () => playerStore.stop());
  container.querySelector('#skip-back-btn').addEventListener('click', () => playerStore.skip(-15));
  container.querySelector('#skip-forward-btn').addEventListener('click', () => playerStore.skip(30));
  container.querySelector('#chapter-picker-btn').addEventListener('click', openChapterSheet);
  container.querySelector('#bookmarks-btn').addEventListener('click', openBookmarksSheet);
  container.querySelector('#speed-down-btn').addEventListener('click', () => playerStore.setRate(stepSpeed(state.rate, -1, EPUB_MAX_SPEED)));
  container.querySelector('#speed-up-btn').addEventListener('click', () => playerStore.setRate(stepSpeed(state.rate, +1, EPUB_MAX_SPEED)));

  progressTrack.addEventListener('click', (e) => {
    if (!state.readAlong?.chunks.length) return;
    const rect = progressTrack.getBoundingClientRect();
    const fraction = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
    unlockMediaForAutoplay();
    playerStore.seekInChapter(Math.min(0.999, Math.max(0, fraction)));
    playerStore.play();
  });

  container.querySelector('#back-btn').addEventListener('click', () => {
    cleanup({ keepPlayback: keepPlaybackOnBack });
    onBack();
  });

  container.querySelector('#settings-link-btn').addEventListener('click', () => {
    cleanup({ keepPlayback: true });
    onOpenSettings();
  });

  initMediaSession(book, {
    onPlay: () => playerStore.play(),
    onPause: () => playerStore.pause(),
    onPreviousTrack: () => playerStore.prevChapter(),
    onNextTrack: () => playerStore.nextChapter(),
  });

  // ---- Chapter and bookmark sheets ----

  function openChapterSheet() {
    if (!state.chapters.length) return;
    document.querySelector('.chapter-sheet')?.remove();

    const sheet = document.createElement('div');
    sheet.className = 'chapter-sheet';
    sheet.innerHTML = `
      <div class="chapter-sheet-panel">
        <div class="chapter-sheet-header">
          <h3>Chapters</h3>
          <button class="icon-btn-touch" id="chapter-sheet-close" type="button" aria-label="Close">${icon('close')}</button>
        </div>
        <div class="chapter-sheet-list">
          ${state.chapters
            .map(
              (c, i) =>
                `<button type="button" data-chapter-index="${i}" class="${i === state.chapterIndex ? 'chapter-current' : ''}">${escapeHtml(c.title)}</button>`,
            )
            .join('')}
        </div>
      </div>
    `;
    document.body.appendChild(sheet);

    sheet.addEventListener('click', (e) => {
      if (e.target === sheet) closeSheet();
    });
    sheet.querySelector('#chapter-sheet-close').addEventListener('click', closeSheet);
    sheet.querySelectorAll('[data-chapter-index]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-chapter-index'));
        closeSheet();
        if (idx !== state.chapterIndex) playerStore.goToChapter(idx);
      });
    });

    sheet.querySelector('.chapter-current')?.scrollIntoView({ block: 'center' });
  }

  function closeSheet() {
    const sheet = document.querySelector('.chapter-sheet');
    if (!sheet) return;
    sheet.classList.add('chapter-sheet--closing');
    sheet.addEventListener('transitionend', () => sheet.remove(), { once: true });
  }

  function addBookmarkHere() {
    const { chapterIndex, readAlong } = state;
    const chunkIndex = readAlong?.chunkIndex ?? 0;
    const chapterName = state.chapters[chapterIndex]?.title ?? `Chapter ${chapterIndex + 1}`;
    const snippet = (readAlong?.chunks[chunkIndex] || '').trim().slice(0, 60);
    const label = snippet ? `${chapterName} — "${snippet}${snippet.length === 60 ? '…' : ''}"` : chapterName;
    bookmarks = [
      {
        id: crypto.randomUUID(),
        label,
        createdAt: Date.now(),
        chapterIndex,
        chunkIndex,
      },
      ...bookmarks,
    ];
    updateBook(book.id, { bookmarks });
    showToast('Bookmark added', 'success');
    openBookmarksSheet();
  }

  function removeBookmark(id) {
    bookmarks = bookmarks.filter((b) => b.id !== id);
    updateBook(book.id, { bookmarks });
    openBookmarksSheet();
  }

  function openBookmarksSheet() {
    document.querySelector('.chapter-sheet')?.remove();

    const sheet = document.createElement('div');
    sheet.className = 'chapter-sheet';
    sheet.innerHTML = `
      <div class="chapter-sheet-panel">
        <div class="chapter-sheet-header">
          <h3>Bookmarks</h3>
          <button class="icon-btn-touch" id="bookmark-sheet-close" type="button" aria-label="Close">${icon('close')}</button>
        </div>
        <button type="button" class="bookmark-add-row" id="bookmark-add-btn">${icon('add', 18)} Bookmark this spot</button>
        <div class="chapter-sheet-list bookmark-list">
          ${bookmarks.length
            ? bookmarks
                .map(
                  (bm) => `
                  <div class="bookmark-row">
                    <button type="button" class="bookmark-jump-btn" data-jump-id="${bm.id}">${escapeHtml(bm.label)}</button>
                    <button type="button" class="icon-btn-touch bookmark-delete-btn" data-remove-id="${bm.id}" aria-label="Delete bookmark">${icon('trash', 16)}</button>
                  </div>
                `,
                )
                .join('')
            : '<p class="bookmark-empty">No bookmarks yet.</p>'}
        </div>
      </div>
    `;
    document.body.appendChild(sheet);

    sheet.addEventListener('click', (e) => {
      if (e.target === sheet) closeSheet();
    });
    sheet.querySelector('#bookmark-sheet-close').addEventListener('click', closeSheet);
    sheet.querySelector('#bookmark-add-btn').addEventListener('click', addBookmarkHere);
    sheet.querySelectorAll('[data-jump-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const bm = bookmarks.find((b) => b.id === btn.getAttribute('data-jump-id'));
        if (bm) jumpToBookmark(bm);
      });
    });
    sheet.querySelectorAll('[data-remove-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeBookmark(btn.getAttribute('data-remove-id'));
      });
    });
  }


  /** Go to a bookmark: load its chapter if needed, then seek to its chunk and play. */
  function jumpToBookmark(bm) {
    closeSheet();
    unlockMediaForAutoplay();
    const seekWhenLoaded = () => {
      const chunks = state.readAlong?.chunks;
      if (state.status === 'loading' || state.chapterIndex !== bm.chapterIndex || !chunks?.length) return;
      pendingSeek = null;
      playerStore.seekInChapter((Math.min(bm.chunkIndex, chunks.length - 1) + 0.5) / chunks.length);
      playerStore.play();
    };
    if (state.chapterIndex === bm.chapterIndex) {
      seekWhenLoaded();
    } else {
      pendingSeek = seekWhenLoaded;
      playerStore.goToChapter(bm.chapterIndex);
    }
  }

  // ---- Start ----

  playerStore.open(book);
  const unsubscribe = playerStore.subscribe(render);
  applyReadAlongVisibility();
  render(playerStore.getState());

  /**
   * @param {{ keepPlayback?: boolean }} options
   */
  function cleanup(options = {}) {
    const { keepPlayback = false } = options;
    closeSheet();
    unsubscribe();
    pendingSeek = null;
    if (!keepPlayback) {
      teardownMediaSession();
      sleepTimer.destroy();
      sleepControl.atChapterEnd = false;
    }
  }

  return { cleanup };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}


const IOS_HINT_KEY = 'ios-web-speech-hint-shown';

/**
 * On iOS the built-in Web Speech voice stops when the screen locks or the
 * app goes to the background. Shown once per device.
 * @param {import('../tts/tts-router.js').TTSSettings} settings
 */
function maybeShowIOSWebSpeechHint(settings) {
  if (!isIOS() || (settings.providerChain?.length ?? 0) > 0) return;
  if (localStorage.getItem(IOS_HINT_KEY)) return;
  localStorage.setItem(IOS_HINT_KEY, '1');
  showToast(
    'Tip: the built-in voice stops when the screen locks. For background listening, add an AI narrator in Settings.',
    'info',
    9000,
  );
}

