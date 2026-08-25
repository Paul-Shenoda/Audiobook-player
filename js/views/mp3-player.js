import jsmediatags from 'jsmediatags';
import { formatTime } from '../utils/format-time.js';
import { createManagedObjectUrl, revokeManagedObjectUrl } from '../utils/object-url.js';
import { updateBook } from '../storage/library-db.js';
import { estimatePercent } from '../tts/playback-state.js';
import { playbackManager } from '../services/playback-manager.js';
import {
  initMediaSession,
  setMediaPlaybackState,
  setMediaPositionState,
  teardownMediaSession,
} from '../services/media-session.js';
import { createSleepTimer } from '../services/sleep-timer.js';
import { icon } from '../utils/icons.js';
import { renderCoverMarkup, getBookCoverUrl } from '../utils/cover-art.js';
import { seriesLabel } from '../utils/series-label.js';
import { showToast } from '../utils/toast.js';

/**
 * @typedef {import('../storage/library-db.js').Book} Book
 */

// Smart resume: rewind a little so the listener regains context.
const RESTORE_REWIND_S = 10; // when reopening a book
const PAUSE_REWIND_S = 15; // when resuming after a long in-session pause
const LONG_PAUSE_MS = 5 * 60 * 1000;

/**
 * @param {HTMLElement} container
 * @param {Book} book
 * @param {{ onBack: () => void, keepPlaybackOnBack?: boolean }} callbacks
 */
export function renderMp3Player(container, book, { onBack, keepPlaybackOnBack = false }) {
  const coverUrl = getBookCoverUrl(book);
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
        <audio id="main-audio"></audio>
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
          <button class="sleep-btn" id="sleep-btn" type="button" aria-label="Sleep timer">${icon('moon', 18)}<span id="sleep-label">Sleep: Off</span></button>
          <button class="sleep-btn" id="bookmarks-btn" type="button" aria-label="Bookmarks">${icon('bookmark', 18)}<span>Bookmarks</span></button>
        </div>
      </div>
    </div>
  `;

  const player = container.querySelector('#main-audio');
  const playBtn = container.querySelector('#play-pause-btn');
  const seekBar = container.querySelector('#seek-bar');
  const currentTimeText = container.querySelector('#current-time');
  const durationText = container.querySelector('#duration');
  const bookTitle = container.querySelector('#book-title');
  const chapterLabel = container.querySelector('#chapter-label');
  const bookPercentEl = container.querySelector('#book-percent');

  playbackManager.audio = player;

  let trackIndex = Math.min(Math.max(book.progress?.trackIndex ?? 0, 0), totalTracks - 1);
  let resumeSeconds = trackIndex === (book.progress?.trackIndex ?? 0) ? book.progress?.seconds ?? 0 : 0;
  let bookmarks = book.bookmarks ?? [];

  function currentTrack() {
    return tracks[trackIndex];
  }

  function updateChapterLabel() {
    if (!hasTrackChapters) return;
    const track = currentTrack();
    chapterLabel.textContent = track?.label || `Track ${trackIndex + 1}`;
    bookTitle.textContent = book.title;
  }

  /** Which in-file chapter the playhead is currently in (0 when no chapters). */
  function currentFileChapterIndex() {
    let idx = 0;
    for (let i = 0; i < fileChapters.length; i += 1) {
      if (fileChapters[i].startSeconds <= player.currentTime) idx = i;
      else break;
    }
    return idx;
  }

  let lastFileChapterIdx = -1;
  function updateFileChapterLabel() {
    if (!hasFileChapters) return;
    const idx = currentFileChapterIndex();
    if (idx === lastFileChapterIdx) return;
    lastFileChapterIdx = idx;
    chapterLabel.textContent = fileChapters[idx]?.title || `Chapter ${idx + 1}`;
  }

  function updateBookPercent() {
    if (!hasChapters) return;
    const percent = estimatePercent(trackIndex, totalTracks, player.currentTime || 0, player.duration || 1);
    bookPercentEl.textContent = `${percent}%`;
  }

  /**
   * Load a track by index. Continuous playback across chapter boundaries —
   * mirrors epub-listen.js's chunk-to-chunk rollover (loadAndPrepareChapter +
   * startListening pattern) for the same "one file per chapter" shape.
   * @param {number} index
   * @param {{ seconds?: number, autoplay?: boolean }} [options]
   */
  function loadTrack(index, { seconds = 0, autoplay = false } = {}) {
    trackIndex = Math.min(Math.max(index, 0), totalTracks - 1);
    const track = currentTrack();
    player.src = createManagedObjectUrl(track.fileBlob);
    player.currentTime = seconds;
    updateChapterLabel();
    if (autoplay) {
      player.play().catch(() => setPlayIcon(false));
    }
  }

  loadTrack(trackIndex, { seconds: Math.max(0, resumeSeconds - RESTORE_REWIND_S) });
  updateFileChapterLabel();

  jsmediatags.read(currentTrack().fileBlob, {
    onSuccess(tag) {
      if (tag.tags.title && !hasChapters) {
        bookTitle.textContent = tag.tags.title;
      }
    },
    onError() {
      // Keep book metadata from library
    },
  });

  container.querySelector('#back-btn').addEventListener('click', () => {
    saveProgress();
    cleanup({ keepPlayback: keepPlaybackOnBack });
    onBack();
  });

  function setPlayIcon(playing) {
    playBtn.innerHTML = playing ? icon('pause', 30) : icon('play', 30);
  }

  /** @type {number|null} */
  let pausedAt = null;

  function play() {
    if (pausedAt && Date.now() - pausedAt > LONG_PAUSE_MS) {
      player.currentTime = Math.max(0, player.currentTime - PAUSE_REWIND_S);
    }
    pausedAt = null;
    player.play().catch(() => setPlayIcon(false));
    setPlayIcon(true);
    playbackManager.setPlaying(true);
  }

  function pause() {
    pausedAt = Date.now();
    player.pause();
    setPlayIcon(false);
    playbackManager.setPaused(true);
  }

  /** Step back 15s, rolling into the previous track's tail at the start. */
  function skipBack() {
    const target = player.currentTime - 15;
    if (target >= 0 || trackIndex === 0) {
      player.currentTime = Math.max(0, target);
      return;
    }
    const wasPlaying = !player.paused;
    loadTrack(trackIndex - 1, { seconds: 0, autoplay: wasPlaying });
    // Land near the end once duration is known (metadata loads async).
    player.addEventListener(
      'loadedmetadata',
      () => {
        player.currentTime = Math.max(0, player.duration + target);
      },
      { once: true },
    );
  }

  /** Step forward 15s, rolling into the next track's head at the end. */
  function skipForward() {
    if (!player.duration) return;
    const target = player.currentTime + 15;
    if (target <= player.duration || trackIndex >= totalTracks - 1) {
      player.currentTime = Math.min(player.duration, target);
      return;
    }
    const overflow = target - player.duration;
    const wasPlaying = !player.paused;
    loadTrack(trackIndex + 1, { seconds: overflow, autoplay: wasPlaying });
  }

  playBtn.addEventListener('click', () => {
    if (player.paused) {
      play();
    } else {
      pause();
    }
  });

  const sleepBtn = container.querySelector('#sleep-btn');
  const sleepLabel = container.querySelector('#sleep-label');
  const sleepTimer = createSleepTimer({
    modes: ['off', '15', '30', '60'],
    onExpire: pause,
    onTick: (text) => {
      sleepLabel.textContent = text;
      sleepBtn.classList.toggle('sleep-btn--active', sleepTimer.getMode() !== 'off');
    },
  });
  sleepBtn.addEventListener('click', () => sleepTimer.cycle());

  container.querySelector('#rewind-btn').addEventListener('click', skipBack);
  container.querySelector('#forward-btn').addEventListener('click', skipForward);

  function goPrevChapter() {
    if (hasTrackChapters) {
      if (trackIndex > 0) loadTrack(trackIndex - 1, { autoplay: !player.paused });
    } else if (hasFileChapters) {
      const idx = currentFileChapterIndex();
      if (idx > 0) {
        player.currentTime = fileChapters[idx - 1].startSeconds;
        updateFileChapterLabel();
      }
    }
  }

  function goNextChapter() {
    if (hasTrackChapters) {
      if (trackIndex < totalTracks - 1) loadTrack(trackIndex + 1, { autoplay: !player.paused });
    } else if (hasFileChapters) {
      const idx = currentFileChapterIndex();
      if (idx < fileChapters.length - 1) {
        player.currentTime = fileChapters[idx + 1].startSeconds;
        updateFileChapterLabel();
      }
    }
  }

  if (hasChapters) {
    container.querySelector('#chapter-picker-btn').addEventListener('click', openChapterSheet);
  }

  /** Chapter/track picker entries — either whole tracks or in-file chapter markers. */
  function chapterSheetItems() {
    return hasTrackChapters
      ? tracks.map((t, i) => ({ index: i, label: t.label || `Track ${i + 1}`, current: i === trackIndex }))
      : fileChapters.map((c, i) => ({
          index: i,
          label: c.title || `Chapter ${i + 1}`,
          current: i === currentFileChapterIndex(),
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
        if (hasTrackChapters) {
          if (idx !== trackIndex) loadTrack(idx, { autoplay: !player.paused });
        } else {
          player.currentTime = fileChapters[idx].startSeconds;
          updateFileChapterLabel();
        }
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
    const track = currentTrack();
    const label = `${track?.label || `Track ${trackIndex + 1}`} — ${formatTime(player.currentTime)}`;
    bookmarks = [
      { id: crypto.randomUUID(), label, createdAt: Date.now(), trackIndex, seconds: player.currentTime },
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
    loadTrack(bm.trackIndex, { seconds: bm.seconds, autoplay: !player.paused });
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

  initMediaSession(book, {
    onPlay: play,
    onPause: pause,
    onSeekBackward: skipBack,
    onSeekForward: skipForward,
    onSeekTo: (seconds) => {
      player.currentTime = seconds;
    },
    onPreviousTrack: hasChapters ? goPrevChapter : undefined,
    onNextTrack: hasChapters ? goNextChapter : undefined,
  });

  player.addEventListener('play', () => setMediaPlaybackState('playing'));
  player.addEventListener('pause', () => setMediaPlaybackState('paused'));

  function setSeekFill(percent) {
    seekBar.style.setProperty('--seek-pct', `${percent}%`);
  }

  player.addEventListener('timeupdate', () => {
    if (!player.duration) return;
    const percent = (player.currentTime / player.duration) * 100;
    seekBar.value = String(percent);
    setSeekFill(percent);
    currentTimeText.textContent = formatTime(player.currentTime);
    durationText.textContent = formatTime(player.duration);
    updateBookPercent();
    updateFileChapterLabel();
    setMediaPositionState({
      duration: player.duration,
      position: player.currentTime,
      playbackRate: player.playbackRate,
    });
  });

  seekBar.addEventListener('input', () => {
    setSeekFill(Number(seekBar.value));
    if (!player.duration) return;
    player.currentTime = (Number(seekBar.value) / 100) * player.duration;
  });

  player.addEventListener('ended', () => {
    if (trackIndex < totalTracks - 1) {
      loadTrack(trackIndex + 1, { autoplay: true });
      return;
    }
    setPlayIcon(false);
    seekBar.value = '0';
    playbackManager.setPaused(true);
    updateBook(book.id, { finishedAt: Date.now() });
  });

  let saveTimer = null;
  function saveProgress() {
    if (!player.duration) return;
    const percent = estimatePercent(trackIndex, totalTracks, player.currentTime, player.duration);
    updateBook(book.id, {
      lastOpenedAt: Date.now(),
      progress: { trackIndex, seconds: player.currentTime, percent },
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
    closeSheet();
    if (!keepPlayback) {
      sleepTimer.destroy();
      player.pause();
      revokeManagedObjectUrl();
      playbackManager.audio = null;
      teardownMediaSession();
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
