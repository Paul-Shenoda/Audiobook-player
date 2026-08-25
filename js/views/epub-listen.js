import {
  openEpub,
  loadChapterText,
  destroyEpub,
  findFirstContentChapter,
  getChapterList,
} from '../epub/epub-loader.js';
import { chunkText } from '../epub/text-extract.js';
import {
  saveEpubProgress,
  loadEpubProgress,
  estimatePercent,
  estimateSecondsRemaining,
} from '../tts/playback-state.js';
import { loadTTSSettings } from '../tts/tts-router.js';
import { getBook, updateBook } from '../storage/library-db.js';
import { playbackManager } from '../services/playback-manager.js';
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
 */

/**
 * @param {HTMLElement} container
 * @param {Book} book
 * @param {{ onBack: () => void, onOpenSettings: () => void, keepPlaybackOnBack?: boolean }} callbacks
 */
export async function renderEpubListen(container, book, { onBack, onOpenSettings, keepPlaybackOnBack = false }) {
  const ttsRouter = playbackManager.tts;

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

  let epubBook = null;
  let chapterIndex = book.progress?.chapterIndex ?? 0;
  let chunks = [];
  let totalChapters = 0;
  let currentChunkIndex = 0;
  /** @type {import('../epub/epub-loader.js').ChapterEntry[]} */
  let chapterList = [];
  let bookmarks = book.bookmarks ?? [];

  const SPEED_STEPS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
  const settings = loadTTSSettings();
  ttsRouter.configure(settings);

  maybeShowIOSWebSpeechHint(settings);

  const READ_ALONG_KEY = 'read-along-open';
  const readAlongPanel = container.querySelector('#read-along-panel');
  const textToggleBtn = container.querySelector('#text-toggle-btn');
  let readAlongOpen = localStorage.getItem(READ_ALONG_KEY) === '1';

  function applyReadAlongVisibility() {
    readAlongPanel.hidden = !readAlongOpen;
    textToggleBtn.classList.toggle('chapter-picker-btn--active', readAlongOpen);
    container.querySelector('.player-view')?.classList.toggle('reading-text', readAlongOpen);
    if (readAlongOpen) highlightChunk(currentChunkIndex);
  }

  textToggleBtn.addEventListener('click', () => {
    readAlongOpen = !readAlongOpen;
    localStorage.setItem(READ_ALONG_KEY, readAlongOpen ? '1' : '0');
    applyReadAlongVisibility();
  });
  applyReadAlongVisibility();

  function renderReadAlong(startChunk) {
    readAlongPanel.innerHTML = chunks
      .map((c, i) => `<p data-chunk-index="${i}">${escapeHtml(c)}</p>`)
      .join('');
    readAlongPanel.querySelectorAll('[data-chunk-index]').forEach((p) => {
      p.addEventListener('click', () => {
        const idx = Number(p.getAttribute('data-chunk-index'));
        jumpToChunk(idx);
      });
    });
    highlightChunk(startChunk);
  }

  function highlightChunk(index) {
    currentChunkIndex = index;
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

  let currentRate = settings.rate ?? 1.0;
  // Clamp to nearest step so the display is always one of the labelled values.
  currentRate = SPEED_STEPS.reduce((prev, s) =>
    Math.abs(s - currentRate) < Math.abs(prev - currentRate) ? s : prev,
  );

  const speedLabel = container.querySelector('#speed-label');
  function updateSpeedDisplay() {
    speedLabel.textContent = `${currentRate}×`;
    container.querySelector('#speed-down-btn').disabled = currentRate <= SPEED_STEPS[0];
    container.querySelector('#speed-up-btn').disabled = currentRate >= SPEED_STEPS[SPEED_STEPS.length - 1];
  }
  updateSpeedDisplay();

  container.querySelector('#speed-down-btn').addEventListener('click', () => {
    const idx = SPEED_STEPS.indexOf(currentRate);
    if (idx > 0) {
      currentRate = SPEED_STEPS[idx - 1];
      ttsRouter.setRate(currentRate);
      updateSpeedDisplay();
      updateProgressDisplay(currentChunkIndex);
    }
  });

  container.querySelector('#speed-up-btn').addEventListener('click', () => {
    const idx = SPEED_STEPS.indexOf(currentRate);
    if (idx < SPEED_STEPS.length - 1) {
      currentRate = SPEED_STEPS[idx + 1];
      ttsRouter.setRate(currentRate);
      updateSpeedDisplay();
      updateProgressDisplay(currentChunkIndex);
    }
  });

  try {
    const arrayBuffer = await readFileBlobArrayBuffer(book);
    const { book: opened, metadata } = await openEpub(arrayBuffer);
    epubBook = opened;
    totalChapters = metadata.spineLength;
    titleEl.textContent = metadata.title;
    authorEl.textContent = metadata.author;
    chapterList = await getChapterList(epubBook);

    // For fresh books (no saved progress), jump past front matter to the first
    // real content chapter automatically.
    const hasSavedProgress = book.progress?.chapterIndex != null || book.progress?.chunkIndex != null;
    if (!hasSavedProgress) {
      chapterIndex = await findFirstContentChapter(epubBook);
    }

    await loadAndPrepareChapter();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    statusText.textContent = `Failed to open EPUB: ${msg}`;
    statusText.classList.add('error');
    showToast(`Failed to open EPUB: ${msg}`, 'error');
  }

  container.querySelector('#back-btn').addEventListener('click', () => {
    cleanup({ keepPlayback: keepPlaybackOnBack });
    onBack();
  });

  container.querySelector('#settings-link-btn').addEventListener('click', () => {
    cleanup({ keepPlayback: true, destroyEpub: false });
    onOpenSettings();
  });

  async function goPrevChapter() {
    if (chapterIndex > 0) {
      ttsRouter.stop();
      chapterIndex -= 1;
      await loadAndPrepareChapter();
    }
  }

  async function goNextChapter() {
    if (chapterIndex < totalChapters - 1) {
      ttsRouter.stop();
      chapterIndex += 1;
      await loadAndPrepareChapter();
    }
  }

  function pauseListening() {
    ttsRouter.pause();
    setListenButton(false, true);
    playbackManager.setPaused(true);
    setMediaPlaybackState('paused');
  }

  const sleepBtn = container.querySelector('#sleep-btn');
  const sleepLabel = container.querySelector('#sleep-label');
  const sleepTimer = createSleepTimer({
    modes: ['off', '15', '30', '60', 'chapter'],
    onExpire: pauseListening,
    onTick: (text) => {
      sleepLabel.textContent = text;
      sleepBtn.classList.toggle('sleep-btn--active', sleepTimer.getMode() !== 'off');
    },
  });
  sleepBtn.addEventListener('click', () => sleepTimer.cycle());

  async function resumeOrStart() {
    if (ttsRouter.isPaused()) {
      ttsRouter.resume();
      setListenButton(true);
      playbackManager.setPlaying(true);
      setMediaPlaybackState('playing');
    } else if (!ttsRouter.isPlaying()) {
      await startListening();
    }
  }

  container.querySelector('#skip-back-btn').addEventListener('click', skipBack);
  container.querySelector('#skip-forward-btn').addEventListener('click', skipForward);
  container.querySelector('#chapter-picker-btn').addEventListener('click', openChapterSheet);

  progressTrack.addEventListener('click', (e) => {
    if (!chunks.length) return;
    const rect = progressTrack.getBoundingClientRect();
    const fraction = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
    const idx = Math.min(chunks.length - 1, Math.max(0, Math.floor(fraction * chunks.length)));
    jumpToChunk(idx);
  });

  /** Stop current speech and jump straight to a chunk in the current chapter. */
  function jumpToChunk(index) {
    ttsRouter.stop();
    return startListening(index);
  }

  /** Step back one text segment, rolling into the previous chapter's last segment at the start. */
  async function skipBack() {
    ttsRouter.stop();
    if (currentChunkIndex > 0) {
      await startListening(currentChunkIndex - 1);
    } else if (chapterIndex > 0) {
      chapterIndex -= 1;
      await loadAndPrepareChapter();
      await startListening(Math.max(chunks.length - 1, 0));
    }
  }

  /** Step forward one text segment, rolling into the next chapter's first segment at the end. */
  async function skipForward() {
    ttsRouter.stop();
    if (currentChunkIndex < chunks.length - 1) {
      await startListening(currentChunkIndex + 1);
    } else if (chapterIndex < totalChapters - 1) {
      chapterIndex += 1;
      await loadAndPrepareChapter();
      await startListening(0);
    }
  }

  function openChapterSheet() {
    if (!chapterList.length) return;
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
          ${chapterList
            .map(
              (c) =>
                `<button type="button" data-chapter-index="${c.spineIndex}" class="${c.spineIndex === chapterIndex ? 'chapter-current' : ''}">${escapeHtml(c.label)}</button>`,
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
      btn.addEventListener('click', async () => {
        const idx = Number(btn.getAttribute('data-chapter-index'));
        closeSheet();
        if (idx !== chapterIndex) {
          ttsRouter.stop();
          setListenButton(false);
          chapterIndex = idx;
          await loadAndPrepareChapter();
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
    const entry = chapterList[chapterIndex];
    const chapterName = entry?.hasTocLabel ? entry.label : `Chapter ${chapterIndex + 1}`;
    const snippet = (chunks[currentChunkIndex] || '').trim().slice(0, 60);
    const label = snippet ? `${chapterName} — "${snippet}${snippet.length === 60 ? '…' : ''}"` : chapterName;
    bookmarks = [
      {
        id: crypto.randomUUID(),
        label,
        createdAt: Date.now(),
        chapterIndex,
        chunkIndex: currentChunkIndex,
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

  async function jumpToBookmark(bm) {
    closeSheet();
    ttsRouter.stop();
    setListenButton(false);
    chapterIndex = bm.chapterIndex;
    await loadAndPrepareChapter();
    await startListening(bm.chunkIndex);
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

  listenBtn.addEventListener('click', async () => {
    unlockMediaForAutoplay();
    if (ttsRouter.isPlaying() && !ttsRouter.isPaused()) {
      pauseListening();
    } else {
      await resumeOrStart();
    }
  });

  container.querySelector('#stop-btn').addEventListener('click', () => {
    ttsRouter.stop();
    setListenButton(false);
    statusText.textContent = 'Stopped';
    playbackManager.setPaused(true);
    setMediaPlaybackState('paused');
  });

  initMediaSession(book, {
    onPlay: resumeOrStart,
    onPause: pauseListening,
    onPreviousTrack: goPrevChapter,
    onNextTrack: goNextChapter,
  });

  function setListenButton(playing, paused = false) {
    if (playing) {
      listenBtn.innerHTML = `${icon('pause', 28)}<span>Pause</span>`;
    } else if (paused) {
      listenBtn.innerHTML = `${icon('play', 28)}<span>Resume</span>`;
    } else {
      listenBtn.innerHTML = `${icon('play', 28)}<span>Listen</span>`;
    }
  }

  async function loadAndPrepareChapter() {
    if (!epubBook) return;
    const entry = chapterList[chapterIndex];
    chapterLabel.textContent = entry?.hasTocLabel
      ? entry.label
      : `Chapter ${chapterIndex + 1} of ${totalChapters}`;
    statusText.textContent = 'Loading chapter...';

    try {
      const text = await loadChapterText(epubBook, chapterIndex);
      chunks = chunkText(text);

      let readyMsg = chunks.length
        ? `Ready — ${chunks.length} segment(s)`
        : 'This chapter has no readable text';
      if (chunks.length && ttsRouter.aiProvider?.estimateCost) {
        const chars = chunks.reduce((sum, c) => sum + c.length, 0);
        const cost = ttsRouter.aiProvider.estimateCost(chars);
        readyMsg += ` · ≈ ${cost < 0.005 ? '<$0.01' : `$${cost.toFixed(2)}`} AI narration`;
      }
      statusText.textContent = readyMsg;

      const saved = loadEpubProgress(book.id);
      const startChunk =
        saved && saved.chapterIndex === chapterIndex ? saved.chunkIndex : 0;
      updateProgressDisplay(startChunk);
      renderReadAlong(startChunk);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      statusText.textContent = `Chapter load error: ${msg}`;
      statusText.classList.add('error');
    }
  }

  /**
   * @param {number} [fromChunk] jump target; defaults to saved progress
   */
  async function startListening(fromChunk) {
    if (!chunks.length) return;

    const saved = loadEpubProgress(book.id);
    const startChunk =
      fromChunk ??
      (saved && saved.chapterIndex === chapterIndex ? saved.chunkIndex : 0);

    ttsRouter.onChunkStart = (index) => {
      updateProgressDisplay(index);
      highlightChunk(index);
      persistProgress(index);
      setListenButton(true);
      playbackManager.setPlaying(true);
      setMediaPlaybackState('playing');
    };

    ttsRouter.onComplete = async () => {
      const atEnd = chapterIndex >= totalChapters - 1;
      const sleepAtChapterEnd = sleepTimer.getMode() === 'chapter';

      if (atEnd || sleepAtChapterEnd) {
        setListenButton(false);
        statusText.textContent = atEnd
          ? 'Book complete'
          : 'Sleep timer — stopped at end of chapter';
        playbackManager.setPaused(true);
        setMediaPlaybackState('paused');
        if (sleepAtChapterEnd) sleepTimer.reset();
        if (atEnd) {
          updateBook(book.id, { finishedAt: Date.now() });
        } else {
          chapterIndex += 1;
          await loadAndPrepareChapter();
        }
        return;
      }

      // Continuous playback: roll straight into the next chapter.
      chapterIndex += 1;
      await loadAndPrepareChapter();
      await startListening();
    };

    ttsRouter.onError = (err) => {
      statusText.textContent = err.message;
      statusText.classList.add('error');
      showToast(err.message, 'error', 6000);
      setListenButton(false);
      playbackManager.setPaused(true);
      setMediaPlaybackState('paused');
    };

    setListenButton(true);
    statusText.textContent = 'Reading aloud...';
    statusText.classList.remove('error');

    await ttsRouter.speak(chunks, startChunk, {
      bookId: book.id,
      chapterIndex,
    });
  }

  function updateProgressDisplay(chunkIndex) {
    const chapterPercent = chunks.length > 0
      ? Math.min(100, Math.round((chunkIndex / chunks.length) * 100))
      : 0;
    progressFill.style.width = `${chapterPercent}%`;
    timeLeftLabel.textContent = formatMinutesLeft(
      estimateSecondsRemaining(chunks, chunkIndex, currentRate),
    );

    const bookPercent = estimatePercent(
      chapterIndex,
      totalChapters,
      chunkIndex,
      chunks.length,
    );
    bookPercentEl.textContent = `${bookPercent}%`;
  }

  function formatMinutesLeft(seconds) {
    const minutes = Math.round(seconds / 60);
    return minutes < 1 ? '< 1 min left' : `${minutes} min left`;
  }

  function persistProgress(chunkIndex) {
    saveEpubProgress(book.id, {
      chapterIndex,
      chunkIndex,
      charOffset: 0,
    });
    updateBook(book.id, {
      lastOpenedAt: Date.now(),
      progress: {
        chapterIndex,
        chunkIndex,
        percent: estimatePercent(chapterIndex, totalChapters, chunkIndex, chunks.length),
      },
    });
  }

  /**
   * @param {{ keepPlayback?: boolean, destroyEpub?: boolean }} options
   */
  function cleanup(options = {}) {
    const { keepPlayback = false, destroyEpub: shouldDestroy = true } = options;
    closeSheet();
    if (!keepPlayback) {
      ttsRouter.stop();
      playbackManager.setPaused(true);
      teardownMediaSession();
      sleepTimer.destroy();
    }
    if (shouldDestroy) {
      destroyEpub(epubBook);
      epubBook = null;
    }
  }

  return { cleanup };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Safari has a long-standing IndexedDB bug where a Blob retrieved from a
 * previous read throws `NotFoundError: The object can not be found here`
 * when its contents are actually accessed — re-fetching the record fresh
 * and retrying once often succeeds where reusing the already-stale Blob
 * reference does not. Falls through to the original error if the retry
 * also fails (including if the book was deleted in the meantime).
 * @param {import('../storage/library-db.js').Book} currentBook
 * @returns {Promise<ArrayBuffer>}
 */
async function readFileBlobArrayBuffer(currentBook) {
  try {
    return await currentBook.fileBlob.arrayBuffer();
  } catch (err) {
    if (!(err instanceof DOMException) || err.name !== 'NotFoundError') throw err;
    const fresh = await getBook(currentBook.id);
    if (!fresh?.fileBlob) throw err;
    return await fresh.fileBlob.arrayBuffer();
  }
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
