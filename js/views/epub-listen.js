import {
  openEpub,
  loadChapterText,
  destroyEpub,
} from '../epub/epub-loader.js';
import { chunkText } from '../epub/text-extract.js';
import {
  saveEpubProgress,
  loadEpubProgress,
  estimatePercent,
} from '../tts/playback-state.js';
import { loadTTSSettings } from '../tts/tts-router.js';
import { updateBook } from '../storage/library-db.js';
import { playbackManager } from '../services/playback-manager.js';
import { icon } from '../utils/icons.js';
import { renderCoverMarkup } from '../utils/cover-art.js';
import { showToast } from '../utils/toast.js';
import { getErrorMessage } from '../utils/error-message.js';

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
        <p class="chapter-label" id="chapter-label">Chapter 1</p>
        <div class="epub-progress-section">
          <div class="progress-bar-track">
            <div class="progress-bar-fill" id="listen-progress" style="width: 0%"></div>
          </div>
          <span class="progress-percent" id="progress-percent">0%</span>
        </div>
        <div class="controls-section">
          <button class="chapter-btn icon-btn-touch" id="prev-chapter-btn" type="button" aria-label="Previous chapter">${icon('prevChapter')}</button>
          <button class="play-btn listen-btn icon-btn-touch" id="listen-pause-btn" type="button" aria-label="Play or pause">${icon('play', 28)}<span>Listen</span></button>
          <button class="chapter-btn icon-btn-touch" id="next-chapter-btn" type="button" aria-label="Next chapter">${icon('nextChapter')}</button>
        </div>
        <button class="stop-btn" id="stop-btn" type="button">Stop</button>
        <p class="status-text" id="status-text"></p>
      </div>
    </div>
  `;

  const titleEl = container.querySelector('#epub-title');
  const authorEl = container.querySelector('#epub-author');
  const chapterLabel = container.querySelector('#chapter-label');
  const progressFill = container.querySelector('#listen-progress');
  const progressPercent = container.querySelector('#progress-percent');
  const statusText = container.querySelector('#status-text');
  const listenBtn = container.querySelector('#listen-pause-btn');

  let epubBook = null;
  let chapterIndex = book.progress?.chapterIndex ?? 0;
  let chunks = [];
  let totalChapters = 0;

  ttsRouter.configure(loadTTSSettings());

  try {
    const arrayBuffer = await book.fileBlob.arrayBuffer();
    const { book: opened, metadata } = await openEpub(arrayBuffer);
    epubBook = opened;
    totalChapters = metadata.spineLength;
    titleEl.textContent = metadata.title;
    authorEl.textContent = metadata.author;

    await loadAndPrepareChapter();
  } catch (err) {
    const msg = getErrorMessage(err);
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

  container.querySelector('#prev-chapter-btn').addEventListener('click', async () => {
    if (chapterIndex > 0) {
      ttsRouter.stop();
      chapterIndex -= 1;
      await loadAndPrepareChapter();
    }
  });

  container.querySelector('#next-chapter-btn').addEventListener('click', async () => {
    if (chapterIndex < totalChapters - 1) {
      ttsRouter.stop();
      chapterIndex += 1;
      await loadAndPrepareChapter();
    }
  });

  listenBtn.addEventListener('click', async () => {
    if (ttsRouter.isPlaying() && !ttsRouter.isPaused()) {
      ttsRouter.pause();
      setListenButton(false, true);
      playbackManager.setPaused(true);
    } else if (ttsRouter.isPaused()) {
      ttsRouter.resume();
      setListenButton(true);
      playbackManager.setPlaying(true);
    } else {
      await startListening();
    }
  });

  container.querySelector('#stop-btn').addEventListener('click', () => {
    ttsRouter.stop();
    setListenButton(false);
    statusText.textContent = 'Stopped';
    playbackManager.setPaused(true);
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
    chapterLabel.textContent = `Chapter ${chapterIndex + 1} of ${totalChapters}`;
    statusText.textContent = 'Loading chapter...';

    try {
      const text = await loadChapterText(epubBook, chapterIndex);
      chunks = chunkText(text);
      statusText.textContent = chunks.length
        ? `Ready — ${chunks.length} segment(s)`
        : 'This chapter has no readable text';

      const saved = loadEpubProgress(book.id);
      const startChunk =
        saved && saved.chapterIndex === chapterIndex ? saved.chunkIndex : 0;
      updateProgressDisplay(startChunk);
    } catch (err) {
      const msg = getErrorMessage(err);
      statusText.textContent = `Chapter load error: ${msg}`;
      statusText.classList.add('error');
    }
  }

  async function startListening() {
    if (!chunks.length) return;

    const saved = loadEpubProgress(book.id);
    const startChunk =
      saved && saved.chapterIndex === chapterIndex ? saved.chunkIndex : 0;

    ttsRouter.onChunkStart = (index) => {
      updateProgressDisplay(index);
      persistProgress(index);
      setListenButton(true);
      playbackManager.setPlaying(true);
    };

    ttsRouter.onComplete = () => {
      setListenButton(false);
      statusText.textContent = 'Chapter complete';
      playbackManager.setPaused(true);
      if (chapterIndex < totalChapters - 1) {
        chapterIndex += 1;
        loadAndPrepareChapter();
      }
    };

    ttsRouter.onError = (err) => {
      statusText.textContent = err.message;
      statusText.classList.add('error');
      showToast(err.message, 'error', 6000);
      setListenButton(false);
      playbackManager.setPaused(true);
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
    const percent = estimatePercent(
      chapterIndex,
      totalChapters,
      chunkIndex,
      chunks.length,
    );
    progressFill.style.width = `${percent}%`;
    progressPercent.textContent = `${percent}%`;
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
    if (!keepPlayback) {
      ttsRouter.stop();
      playbackManager.setPaused(true);
    }
    if (shouldDestroy) {
      destroyEpub(epubBook);
      epubBook = null;
    }
  }

  return { cleanup };
}
