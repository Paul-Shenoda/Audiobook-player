import { clampSpeed, EPUB_MAX_SPEED } from '../utils/playback-speed.js';
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
  estimateSecondsForChars,
  estimateCharsForSeconds,
} from '../tts/playback-state.js';
import { loadTTSSettings, sharedTtsRouter } from '../tts/tts-router.js';
import { createSleepTimer } from '../services/sleep-timer.js';
import { getBookFile, updateBook } from '../storage/library-db.js';

/**
 * @typedef {import('../storage/library-db.js').Book} Book
 * @typedef {import('./../services/player-store.js').PlayerEngine} PlayerEngine
 */

/**
 * Read the EPUB file fresh from the `files` store each time (never from a
 * Blob held on the book): Safari invalidates a Blob read earlier once its
 * record is rewritten. The files store is never rewritten, but one retry
 * covers a read that raced a write elsewhere.
 * @param {Book} currentBook
 * @returns {Promise<ArrayBuffer>}
 */
async function readFileBlobArrayBuffer(currentBook) {
  for (let attempt = 0; ; attempt += 1) {
    const blob = await getBookFile(currentBook.id);
    if (!blob) throw new Error('The book file is missing from the library.');
    try {
      return await blob.arrayBuffer();
    } catch (err) {
      if (attempt > 0 || !(err instanceof DOMException) || err.name !== 'NotFoundError') throw err;
    }
  }
}

/**
 * EPUB playback: text chunks read aloud through the TTS router.
 * Every dependency can be injected so tests need no real EPUB or speech.
 * @param {Object} [deps]
 * @returns {PlayerEngine & { whenIdle: () => Promise<void> }}
 */
export function createTtsEngine(deps = {}) {
  const {
    router = sharedTtsRouter,
    readBlob = readFileBlobArrayBuffer,
    openEpub: open = openEpub,
    getChapterList: listChapters = getChapterList,
    findFirstContentChapter: findFirst = findFirstContentChapter,
    loadChapterText: loadText = loadChapterText,
    chunkText: chunk = chunkText,
    destroyEpub: destroyBook = destroyEpub,
    updateBook: saveBook = updateBook,
    loadSettings = loadTTSSettings,
  } = deps;

  /** @type {Book|null} */
  let book = null;
  let emit = () => {};
  let epub = null;
  let destroyed = false;
  let totalChapters = 0;
  /** @type {import('../epub/epub-loader.js').ChapterEntry[]} */
  let chapterList = [];
  let chapterIndex = 0;
  /** @type {string[]} */
  let chunks = [];
  let chunkIndex = 0;
  /**
   * Last known character offset inside the current chunk: the latest word
   * boundary, or where the chunk was (re)started. It is also where speech
   * continues after pause/speed change, so it is 0 for voices without boundaries.
   */
  let knownChar = 0;
  /** When knownChar was set; the ticker adds the time since then. */
  let anchorTime = Date.now();
  /** @type {ReturnType<typeof setInterval>|null} */
  let ticker = null;
  let lastCharSave = 0;
  let rate = 1;
  /** True from play() until pause, error or the end of the book. */
  let wantPlaying = false;
  const sleepTimer = createSleepTimer({
    onExpire: () => {
      enqueue(() => {
        wantPlaying = false;
        router.pause();
        publish({ status: 'paused', sleep: { mode: 'off' } });
      });
    },
  });
  /** Last queued command; null when idle. Commands run one at a time, in order. */
  let tail = null;

  function reportError(err) {
    emit({ status: 'error', error: err instanceof Error ? err.message : String(err) });
  }

  /** Run `fn` now if idle (keeps the user-gesture call chain short), else after the previous command. */
  function enqueue(fn) {
    const exec = () => {
      try {
        return Promise.resolve(fn());
      } catch (err) {
        return Promise.reject(err);
      }
    };
    const p = (tail ? tail.then(exec) : exec()).catch(reportError);
    tail = p;
    p.then(() => {
      if (tail === p) tail = null;
    });
  }

  /** Where narration is now, as an offset in the current chunk. Between word boundaries it is interpolated. */
  function currentChar() {
    const len = chunks[chunkIndex]?.length ?? 0;
    let pos = knownChar;
    if (ticker) {
      const fraction = router.getAudioFraction?.();
      pos = fraction != null
        ? fraction * len
        : knownChar + estimateCharsForSeconds((Date.now() - anchorTime) / 1000, rate);
    }
    return Math.min(Math.max(pos, 0), len);
  }

  /** Seconds into the chapter: all earlier chunks plus the position in this one. */
  function elapsedSeconds() {
    let chars = currentChar();
    for (let i = 0; i < chunkIndex; i += 1) chars += chunks[i].length;
    return estimateSecondsForChars(chars, rate);
  }

  function setKnownChar(chars) {
    knownChar = chars;
    anchorTime = Date.now();
  }

  function startTicker() {
    if (ticker || destroyed) return;
    ticker = setInterval(() => emit({ chapterElapsed: elapsedSeconds() }), 1000);
  }

  /** Stop ticking; an AI voice's position is kept as the place to continue from. */
  function stopTicker() {
    if (ticker && router.getAudioFraction?.() != null) knownChar = currentChar();
    if (ticker) clearInterval(ticker);
    ticker = null;
  }

  function publish(extra = {}) {
    if (extra.status === 'playing') {
      if (!ticker) anchorTime = Date.now();
      startTicker();
    } else if (extra.status) {
      stopTicker();
    }
    const duration = estimateSecondsRemaining(chunks, 0, rate);
    emit({
      rate,
      chapterIndex,
      chapterElapsed: elapsedSeconds(),
      chapterDuration: duration,
      bookPercent: estimatePercent(chapterIndex, totalChapters, chunkIndex, chunks.length),
      readAlong: { chunks, chunkIndex },
      ...extra,
    });
  }

  function persistProgress() {
    const percent = estimatePercent(chapterIndex, totalChapters, chunkIndex, chunks.length);
    saveEpubProgress(book.id, { chapterIndex, chunkIndex, charIndex: Math.round(knownChar) });
    lastCharSave = Date.now();
    saveBook(book.id, {
      lastOpenedAt: Date.now(),
      progress: { chapterIndex, chunkIndex, percent },
    })?.catch?.(err => console.warn('Could not save progress', err));
  }

  function chapterTitle(i) {
    const entry = chapterList[i];
    return entry?.hasTocLabel ? entry.label : `Chapter ${i + 1} of ${totalChapters}`;
  }

  /** Load a chapter's text and park at `startChunk` (-1 = last chunk). */
  async function loadChapter(index, startChunk = 0) {
    const text = await loadText(epub, index);
    if (destroyed) return;
    chapterIndex = index;
    chunks = chunk(text);
    knownChar = 0;
    chunkIndex = startChunk < 0 ? Math.max(chunks.length - 1, 0) : Math.min(startChunk, Math.max(chunks.length - 1, 0));
  }

  async function speakFrom(index, startChar = 0) {
    if (!chunks.length) {
      wantPlaying = false;
      publish({ status: 'paused', error: 'This chapter has no readable text' });
      return;
    }
    chunkIndex = index;
    // Only Web Speech can start mid-chunk; AI voices play the chunk's audio from its start.
    setKnownChar(router.aiProvider ? 0 : startChar);
    await router.speak(chunks, index, { bookId: book.id, chapterIndex, startChar: knownChar });
  }

  /** Move to a position in the chapter that is already loaded. */
  async function positionAt(index) {
    chunkIndex = Math.min(Math.max(index, 0), Math.max(chunks.length - 1, 0));
    setKnownChar(0);
    if (wantPlaying) {
      await speakFrom(chunkIndex);
    } else {
      router.stop(); // drop any paused speech so the next play() starts here
      persistProgress();
      publish();
    }
  }

  /** Load another chapter; keep playing if we were. */
  async function jumpToChapter(index, startChunk = 0) {
    const resume = wantPlaying;
    router.stop();
    await loadChapter(index, startChunk);
    if (destroyed) return;
    persistProgress();
    publish({ error: null });
    if (resume) await speakFrom(chunkIndex);
    else publish({ status: 'paused' });
  }

  function handleChunkStart(index, startChar = 0) {
    if (destroyed) return;
    chunkIndex = index;
    setKnownChar(startChar);
    persistProgress();
    publish({ status: 'playing', error: null });
  }

  /** A word boundary from the voice: the exact position, so snap to it. */
  function handleProgress(index, charIndex) {
    if (destroyed || index !== chunkIndex) return;
    setKnownChar(charIndex);
    emit({ chapterElapsed: elapsedSeconds() });
    // Remember the word for reopening, but not on every word.
    if (Date.now() - lastCharSave >= 2000) {
      saveEpubProgress(book.id, { chapterIndex, chunkIndex, charIndex });
      lastCharSave = Date.now();
    }
  }

  function handleComplete() {
    if (destroyed) return;
    enqueue(async () => {
      const atEnd = chapterIndex >= totalChapters - 1;
      const sleepAtChapterEnd = sleepTimer.getMode() === 'chapter';

      if (atEnd || sleepAtChapterEnd) {
        wantPlaying = false;
        if (atEnd) {
          saveBook(book.id, { finishedAt: Date.now() })?.catch?.(() => {});
          publish({ status: 'paused', sleep: sleepTimer.set('off') });
          return;
        }
        // Sleep timer: park at the start of the next chapter.
        const sleep = sleepTimer.set('off');
        await loadChapter(chapterIndex + 1);
        if (destroyed) return;
        persistProgress();
        publish({ status: 'paused', sleep });
        return;
      }

      // Continuous playback: roll straight into the next chapter.
      await loadChapter(chapterIndex + 1);
      if (destroyed) return;
      await speakFrom(0);
    });
  }

  function handleError(err) {
    if (destroyed) return;
    wantPlaying = false;
    publish({ status: 'paused', error: err.message });
  }

  return {
    async load(newBook, emitFn) {
      book = newBook;
      emit = emitFn;

      // Speed is per book. A book without one starts at 1x: the old global
      // default may hold another book's speed, and the shared router keeps the
      // previous book's rate until it is configured again.
      rate = clampSpeed(book.playbackRate, EPUB_MAX_SPEED);
      router.stop();
      router.configure({ ...loadSettings(), rate });
      router.onChunkStart = handleChunkStart;
      router.onProgress = handleProgress;
      router.onComplete = handleComplete;
      router.onError = handleError;

      emit({ status: 'loading', rate });

      const opened = await open(await readBlob(book));
      if (destroyed) {
        destroyBook(opened.book);
        return;
      }
      epub = opened.book;
      totalChapters = opened.metadata.spineLength;
      chapterList = await listChapters(epub);
      emit({ chapters: chapterList.map((_, i) => ({ title: chapterTitle(i) })) });

      // Fresh book: jump past front matter to the first real content chapter.
      const hasSavedProgress = book.progress?.chapterIndex != null || book.progress?.chunkIndex != null;
      const startChapter = hasSavedProgress ? (book.progress?.chapterIndex ?? 0) : await findFirst(epub);

      await loadChapter(startChapter);
      if (destroyed) return;
      const saved = loadEpubProgress(book.id) ?? book.progress;
      const savedChunk = saved && saved.chapterIndex === chapterIndex ? saved.chunkIndex : 0;
      chunkIndex = Math.min(savedChunk, Math.max(chunks.length - 1, 0));
      // Older saves have no charIndex: continue from the chunk start.
      const savedChar = saved && saved.chapterIndex === chapterIndex && saved.chunkIndex === chunkIndex ? saved.charIndex : 0;
      setKnownChar(Math.min(Math.max(savedChar ?? 0, 0), chunks[chunkIndex]?.length ?? 0));
      publish({ status: 'paused', error: null });
    },

    play() {
      enqueue(async () => {
        if (wantPlaying || !book || !chunks.length) return;
        wantPlaying = true;
        if (router.isPaused()) {
          router.resume();
          // Web Speech reports 'playing' from onChunkStart; the audio element has no such event.
          if (router.aiProvider) publish({ status: 'playing' });
        } else {
          await speakFrom(chunkIndex, knownChar);
        }
      });
    },

    pause() {
      enqueue(() => {
        wantPlaying = false;
        router.pause();
        publish({ status: 'paused' });
        persistProgress();
      });
    },

    setRate(newRate) {
      const next = clampSpeed(newRate, EPUB_MAX_SPEED);
      if (next === rate) return;
      // Speech re-starts from the last known word, so count time from here at the new speed.
      setKnownChar(knownChar);
      rate = next;
      // The router re-speaks the current chunk at the new rate (Web Speech) or
      // sets audio.playbackRate (AI providers). It never writes the saved default.
      router.setRate(rate, { saveAsDefault: false });
      saveBook(book.id, { playbackRate: rate })?.catch?.(err => console.warn('Could not save speed', err));
      publish();
    },

    setSleep(mode) {
      emit({ sleep: sleepTimer.set(mode) });
    },

    skip(seconds) {
      enqueue(async () => {
        if (!chunks.length) return;
        const duration = estimateSecondsRemaining(chunks, 0, rate);
        const perChunk = duration / chunks.length;
        const steps = Math.max(1, Math.round(Math.abs(seconds) / perChunk));
        const target = chunkIndex + (seconds < 0 ? -steps : steps);

        if (target < 0 && chapterIndex > 0) await jumpToChapter(chapterIndex - 1, -1);
        else if (target >= chunks.length && chapterIndex < totalChapters - 1) await jumpToChapter(chapterIndex + 1);
        else await positionAt(target);
      });
    },

    goToChapter(index) {
      enqueue(async () => {
        if (index < 0 || index >= totalChapters) return;
        await jumpToChapter(index);
      });
    },

    seekInChapter(fraction) {
      enqueue(async () => {
        if (!chunks.length) return;
        await positionAt(Math.floor(fraction * chunks.length));
      });
    },

    destroy() {
      destroyed = true;
      wantPlaying = false;
      sleepTimer.destroy();
      stopTicker();
      router.stop();
      router.onChunkStart = null;
      router.onProgress = null;
      router.onComplete = null;
      router.onError = null;
      destroyBook(epub);
      epub = null;
    },

    /** Resolves when every queued command has finished (used by tests). */
    async whenIdle() {
      while (tail) await tail;
    },
  };
}
