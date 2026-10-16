import jsmediatags from 'jsmediatags';
import { formatTime } from '../utils/format-time.js';
import { updateBook } from '../storage/library-db.js';
import { playerStore } from '../services/player-store.js';
import { stepSpeed } from '../utils/playback-speed.js';
import {
  initMediaSession,
  setMediaPlaybackState,
  setMediaPositionState,
  teardownMediaSession,
} from '../services/media-session.js';
import { createSleepTimer } from '../services/sleep-timer.js';
import { icon } from '../utils/icons.js';
import { renderCoverMarkup } from '../utils/cover-art.js';
import { seriesLabel } from '../utils/series-label.js';
import { showToast } from '../utils/toast.js';

/**
 * @typedef {import('../storage/library-db.js').Book} Book
 */

const SKIP_BACK_S = 15;
const SKIP_FORWARD_S = 15;

/**
 * Audio book player screen. A thin view: it renders what the player store says
 * and sends commands to it. All <audio> handling lives in engines/audio-engine.js.
 * @param {HTMLElement} container
 * @param {Book} book
 * @param {{ onBack: () => void, keepPlaybackOnBack?: boolean }} callbacks
 */
export function renderMp3Player(container, book, { onBack, keepPlaybackOnBack = false }) {
  const tracks = book.tracks ?? [];
  const totalTracks = tracks.length;
  // In-file chapter markers only apply to a book with a single physical
  // track (e.g. an M4B) — a multi-track book's tracks are its chapters.
  const fileChapters = totalTracks === 1 ? (tracks[0]?.chapters ?? []) : [];
  const hasTrackChapters = totalTracks > 1;
  const hasFileChapters = !hasTrackChapters && fileChapters.length > 1;
  const hasChapters = hasTrackChapters || hasFileChapters;

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
          <h2 id="book-title" class="player-title">${escapeHtml(book.title)}</h2>
          <p id="author-name" class="player-author">${escapeHtml(book.author)}</p>
          ${book.series ? `<p class="player-series" id="series-label">${escapeHtml(seriesLabel(book.series))}</p>` : ''}
        </div>
        ${hasChapters ? `
        <div class="chapter-row">
          <button class="chapter-picker-btn" id="chapter-picker-btn" type="button" aria-label="Choose chapter">${icon('list', 18)}<span id="chapter-label">Track 1</span></button>
          <span class="book-percent" id="book-percent" aria-label="Book progress">0%</span>
        </div>
        ` : ''}
        <div class="progress-section">
          <input type="range" class="seek-range" id="seek-bar" value="0" min="0" max="100" step="0.1" aria-label="Seek">
          <div class="time-labels">
            <span id="current-time">0:00</span>
            <span id="duration">0:00</span>
          </div>
        </div>
        <div class="controls-section controls-section--transport">
          <button class="skip-btn icon-btn-touch" id="rewind-btn" type="button" aria-label="Rewind 15 seconds">${icon('replay15', 30)}</button>
          <button class="play-btn play-btn--circle icon-btn-touch" id="play-pause-btn" type="button" aria-label="Play or pause">${icon('play', 30)}</button>
          <button class="skip-btn icon-btn-touch" id="forward-btn" type="button" aria-label="Forward 15 seconds">${icon('forward15', 30)}</button>
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
        </div>
      </div>
    </div>
  `;

  const playBtn = container.querySelector('#play-pause-btn');
  const seekBar = container.querySelector('#seek-bar');
  const currentTimeText = container.querySelector('#current-time');
  const durationText = container.querySelector('#duration');
  const bookTitle = container.querySelector('#book-title');
  const chapterLabel = container.querySelector('#chapter-label');
  const bookPercentEl = container.querySelector('#book-percent');
  const speedLabel = container.querySelector('#speed-label');
  const speedDownBtn = container.querySelector('#speed-down-btn');
  const speedUpBtn = container.querySelector('#speed-up-btn');

  let bookmarks = book.bookmarks ?? [];
  const state = () => playerStore.getState();

  // Loads the book into the store (no-op when it is already the loaded book).
  playerStore.open(book);

  jsmediatags.read(tracks[0].fileBlob, {
    onSuccess(tag) {
      if (tag.tags.title && !hasChapters) {
        bookTitle.textContent = tag.tags.title;
      }
    },
    onError() {
      // Keep book metadata from library
    },
  });

  function setSeekFill(percent) {
    seekBar.style.setProperty('--seek-pct', `${percent}%`);
  }

  let lastError = null;

  /** Draw everything from the store's state. */
  function render(s) {
    if (s.book?.id !== book.id) return;
    playBtn.innerHTML = s.status === 'playing' ? icon('pause', 30) : icon('play', 30);
    if (s.chapterDuration) {
      const percent = (s.chapterElapsed / s.chapterDuration) * 100;
      seekBar.value = String(percent);
      setSeekFill(percent);
      currentTimeText.textContent = formatTime(s.chapterElapsed);
      durationText.textContent = formatTime(s.chapterDuration);
    }
    if (hasChapters) {
      chapterLabel.textContent = s.chapters[s.chapterIndex]?.title || `Track ${s.chapterIndex + 1}`;
      bookPercentEl.textContent = `${s.bookPercent}%`;
    }
    speedLabel.textContent = `${s.rate}×`;
    speedDownBtn.disabled = s.rate === stepSpeed(s.rate, -1);
    speedUpBtn.disabled = s.rate === stepSpeed(s.rate, +1);
    if (s.status === 'error' && s.error && s.error !== lastError) showToast(s.error, 'error');
    lastError = s.status === 'error' ? s.error : null;
  }
  render(state());
  const unsubscribe = playerStore.subscribe(render);

  container.querySelector('#back-btn').addEventListener('click', () => {
    cleanup({ keepPlayback: keepPlaybackOnBack });
    onBack();
  });

  playBtn.addEventListener('click', () => playerStore.toggle());

  const sleepBtn = container.querySelector('#sleep-btn');
  const sleepLabel = container.querySelector('#sleep-label');
  const sleepTimer = createSleepTimer({
    modes: ['off', '15', '30', '60'],
    onExpire: () => playerStore.pause(),
    onTick: (text) => {
      sleepLabel.textContent = text;
      sleepBtn.classList.toggle('sleep-btn--active', sleepTimer.getMode() !== 'off');
    },
  });
  sleepBtn.addEventListener('click', () => sleepTimer.cycle());

  container.querySelector('#rewind-btn').addEventListener('click', () => playerStore.skip(-SKIP_BACK_S));
  container.querySelector('#forward-btn').addEventListener('click', () => playerStore.skip(SKIP_FORWARD_S));

  seekBar.addEventListener('input', () => {
    setSeekFill(Number(seekBar.value));
    playerStore.seekInChapter(Number(seekBar.value) / 100);
  });

  speedDownBtn.addEventListener('click', () => playerStore.setRate(stepSpeed(state().rate, -1)));
  speedUpBtn.addEventListener('click', () => playerStore.setRate(stepSpeed(state().rate, +1)));

  /** Seek to a position in the current file (seconds), e.g. from the lock screen. */
  function seekFile(seconds) {
    let start = 0;
    if (hasFileChapters) {
      let idx = 0;
      for (let i = 0; i < fileChapters.length; i += 1) {
        if (fileChapters[i].startSeconds <= seconds) idx = i;
        else break;
      }
      if (idx !== state().chapterIndex) playerStore.goToChapter(idx);
      start = fileChapters[idx].startSeconds;
    }
    const length = state().chapterDuration;
    if (length > 0) playerStore.seekInChapter((seconds - start) / length);
  }

  /** Jump to a position in a given file, loading that file first if needed. */
  function jumpTo(trackIndex, seconds) {
    if (trackIndex === state().trackIndex) {
      seekFile(seconds);
      return;
    }
    playerStore.goToChapter(trackIndex);
    // The new file's length is unknown until its metadata loads.
    const stop = playerStore.subscribe((s) => {
      if (s.book?.id !== book.id) {
        stop();
      } else if (s.trackIndex === trackIndex && s.trackDuration > 0) {
        stop();
        seekFile(seconds);
      }
    });
  }

  if (hasChapters) {
    container.querySelector('#chapter-picker-btn').addEventListener('click', openChapterSheet);
  }

  /** Chapter/track picker entries — either whole tracks or in-file chapter markers. */
  function chapterSheetItems() {
    const { chapters, chapterIndex } = state();
    return chapters.map((c, i) => ({
      index: i,
      label: c.title || (hasTrackChapters ? `Track ${i + 1}` : `Chapter ${i + 1}`),
      current: i === chapterIndex,
    }));
  }

  function openChapterSheet() {
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
          ${chapterSheetItems()
            .map(
              (it) =>
                `<button type="button" data-chapter-index="${it.index}" class="${it.current ? 'chapter-current' : ''}">${escapeHtml(it.label)}</button>`,
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
        if (idx !== state().chapterIndex) playerStore.goToChapter(idx);
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


  container.querySelector('#bookmarks-btn').addEventListener('click', openBookmarksSheet);

  function addBookmarkHere() {
    const { trackIndex, trackSeconds } = state();
    const track = tracks[trackIndex];
    const label = `${track?.label || `Track ${trackIndex + 1}`} — ${formatTime(trackSeconds)}`;
    bookmarks = [
      { id: crypto.randomUUID(), label, createdAt: Date.now(), trackIndex, seconds: trackSeconds },
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

  function jumpToBookmark(bm) {
    closeSheet();
    jumpTo(bm.trackIndex ?? 0, bm.seconds ?? 0);
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


  // Lock-screen controls and playback state follow the store, not this view.
  // With keepPlaybackOnBack this subscription outlives the view, until another book replaces this one.
  initMediaSession(book, {
    onPlay: () => playerStore.play(),
    onPause: () => playerStore.pause(),
    onSeekBackward: () => playerStore.skip(-SKIP_BACK_S),
    onSeekForward: () => playerStore.skip(SKIP_FORWARD_S),
    onSeekTo: seekFile,
    onPreviousTrack: hasChapters ? () => playerStore.prevChapter() : undefined,
    onNextTrack: hasChapters ? () => playerStore.nextChapter() : undefined,
  });

  const unsubscribeMedia = playerStore.subscribe((s) => {
    if (s.book?.id !== book.id) {
      unsubscribeMedia();
      return;
    }
    setMediaPlaybackState(s.status === 'playing' ? 'playing' : 'paused');
    setMediaPositionState({ duration: s.trackDuration, position: s.trackSeconds, playbackRate: s.rate });
  });

  /**
   * @param {{ keepPlayback?: boolean }} options
   */
  function cleanup(options = {}) {
    const { keepPlayback = false } = options;
    unsubscribe();
    closeSheet();
    if (!keepPlayback) {
      // Playback is really stopping.
      unsubscribeMedia();
      sleepTimer.destroy();
      playerStore.pause();
      teardownMediaSession();
    }
  }

  return { cleanup };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
