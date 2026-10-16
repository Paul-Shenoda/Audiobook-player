/**
 * @typedef {import('../storage/library-db.js').Book} Book
 */

/**
 * @typedef {Object} PlayerState
 * @property {Book|null} book
 * @property {'audio'|'epub'|null} kind
 * @property {'idle'|'loading'|'playing'|'paused'|'error'} status
 * @property {string|null} error
 * @property {number} rate
 * @property {{title: string, duration?: number}[]} chapters
 * @property {number} chapterIndex
 * @property {number} chapterElapsed seconds (estimated for EPUBs)
 * @property {number} chapterDuration seconds (estimated for EPUBs)
 * @property {number} bookPercent 0-100
 * @property {{chunks: string[], chunkIndex: number}|null} readAlong EPUB only
 * @property {{mode: 'off'|'15'|'30'|'chapter', endsAt?: number}} sleep endsAt is a Date.now() time for timed modes
 */

/**
 * What an engine must provide. The store never touches <audio>,
 * speechSynthesis or TTSRouter itself; engines report back through `emit`.
 * @typedef {Object} PlayerEngine
 * @property {(book: Book, emit: (partial: Partial<PlayerState>) => void) => void|Promise<void>} load
 * @property {() => void|Promise<void>} play
 * @property {() => void} pause
 * @property {(rate: number) => void} setRate
 * @property {(seconds: number) => void} skip negative goes back
 * @property {(mode: 'off'|'15'|'30'|'chapter') => void} setSleep
 * @property {(index: number) => void} goToChapter
 * @property {(fraction: number) => void} seekInChapter 0-1 within the current chapter
 * @property {() => void} destroy stop playback and release everything
 */

/** @typedef {(kind: 'audio'|'epub') => PlayerEngine} EngineFactory */

/** @returns {PlayerState} */
function initialState() {
  return {
    book: null,
    kind: null,
    status: 'idle',
    error: null,
    rate: 1,
    chapters: [],
    chapterIndex: 0,
    chapterElapsed: 0,
    chapterDuration: 0,
    bookPercent: 0,
    readAlong: null,
    sleep: { mode: 'off' },
  };
}

/**
 * One source of truth for playback. Views subscribe and send commands;
 * the active engine reports what is really happening via `emit`.
 * `status` is only ever set by an engine emit, never by a command.
 * @param {{ createEngine?: EngineFactory }} [options]
 */
export function createPlayerStore({ createEngine } = {}) {
  let engineFactory = createEngine ?? null;
  /** @type {PlayerState} */
  let state = initialState();
  /** @type {PlayerEngine|null} */
  let engine = null;
  /** @type {Set<(state: PlayerState) => void>} */
  const listeners = new Set();

  function notify() {
    for (const fn of [...listeners]) fn(state);
  }

  /** @param {Partial<PlayerState>} partial */
  function setState(partial) {
    state = { ...state, ...partial };
    notify();
  }

  function destroyEngine() {
    const old = engine;
    engine = null; // emits from the old engine are ignored from here on
    old?.destroy();
  }

  return {
    getState: () => state,

    /**
     * @param {(state: PlayerState) => void} fn
     * @returns {() => void} unsubscribe
     */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** @param {EngineFactory} fn */
    setEngineFactory(fn) {
      engineFactory = fn;
    },

    /** @param {Book} book */
    open(book) {
      // Same book already loaded: keep it (a reload would bring back stale Blobs on Safari).
      // A book that failed to load can be retried.
      if (state.book && state.book.id === book.id && state.status !== 'error') return;
      if (!engineFactory) throw new Error('Player store has no engine factory set');

      destroyEngine();
      const kind = book.type === 'mp3' ? 'audio' : 'epub';
      state = { ...initialState(), book, kind, status: 'loading' };
      notify();

      const created = engineFactory(kind);
      engine = created;
      const emit = partial => {
        if (engine === created) setState(partial);
      };
      try {
        const loading = created.load(book, emit);
        // Async engines report load failures as a rejected promise.
        loading?.catch?.(err => emit({ status: 'error', error: err?.message ?? String(err) }));
      } catch (err) {
        emit({ status: 'error', error: err?.message ?? String(err) });
      }
    },

    play() {
      engine?.play();
    },
    pause() {
      engine?.pause();
    },
    toggle() {
      if (state.status === 'playing') engine?.pause();
      else engine?.play();
    },
    /** @param {number} rate */
    setRate(rate) {
      engine?.setRate(rate);
    },
    /** @param {number} seconds */
    skip(seconds) {
      engine?.skip(seconds);
    },
    nextChapter() {
      if (state.chapterIndex < state.chapters.length - 1) engine?.goToChapter(state.chapterIndex + 1);
    },
    prevChapter() {
      if (state.chapterIndex > 0) engine?.goToChapter(state.chapterIndex - 1);
    },
    /** @param {number} index */
    goToChapter(index) {
      engine?.goToChapter(index);
    },
    /** @param {number} fraction */
    seekInChapter(fraction) {
      engine?.seekInChapter(fraction);
    },

    /** @param {'off'|'15'|'30'|'chapter'} mode */
    setSleep(mode) {
      engine?.setSleep(mode);
    },

    /** Pause but keep the book loaded. */
    stop() {
      engine?.pause();
    },

    /** Unload the book and reset to idle. */
    close() {
      destroyEngine();
      state = initialState();
      notify();
    },
  };
}

/** App-wide store. The real engines register their factory at startup. */
export const playerStore = createPlayerStore();
