import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTtsEngine } from '../js/engines/tts-engine.js';
import { TTSRouter } from '../js/tts/tts-router.js';
import { loadEpubProgress } from '../js/tts/playback-state.js';

/** Speech synthesis that records calls and fires `end` on cancel, like Safari. */
function installFakeSpeech({ autoStart = true } = {}) {
  const fake = {
    spoken: [], // every utterance ever passed to speak()
    cancels: 0,
    current: null,
    speak(u) {
      fake.spoken.push(u);
      fake.current = u;
      if (autoStart) u.onstart?.();
    },
    cancel() {
      fake.cancels += 1;
      const u = fake.current;
      fake.current = null;
      u?.onend?.(); // Safari fires end after cancel
    },
    start() {
      fake.current?.onstart?.();
    },
    /** The voice reports a word boundary. */
    boundary(charIndex) {
      fake.current?.onboundary?.({ charIndex, name: 'word' });
    },
    /** The current utterance finishes naturally. */
    finish() {
      const u = fake.current;
      fake.current = null;
      u?.onend?.();
    },
    getVoices: () => [],
    texts: () => fake.spoken.map(u => u.text),
  };
  globalThis.speechSynthesis = fake;
  globalThis.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
      this.rate = 1;
    }
  };
  return fake;
}

// Each chunk is 275 chars = 20 s of narration at 1x (150 wpm * 5.5 cpw).
const chunk = label => label.padEnd(275, '.');
const CHAPTERS = [
  ['front matter', 'copyright'].map(chunk), // 0
  ['a0', 'a1', 'a2', 'a3', 'a4'].map(chunk), // 1
  ['b0', 'b1'].map(chunk), // 2
];

function makeDeps(overrides = {}) {
  const epub = { id: 'epub-handle' };
  return {
    epub,
    router: new TTSRouter(),
    readBlob: vi.fn(async () => new ArrayBuffer(8)),
    openEpub: vi.fn(async () => ({ book: epub, metadata: { title: 'T', author: 'A', spineLength: CHAPTERS.length } })),
    getChapterList: vi.fn(async () =>
      CHAPTERS.map((_, i) => ({ spineIndex: i, label: `Title ${i}`, hasTocLabel: i === 1 })),
    ),
    findFirstContentChapter: vi.fn(async () => 1),
    loadChapterText: vi.fn(async (_b, i) => CHAPTERS[i].join('|')),
    chunkText: text => text.split('|'),
    destroyEpub: vi.fn(),
    updateBook: vi.fn(async () => {}),
    loadSettings: () => ({ rate: 1, webSpeechVoiceId: '' }),
    ...overrides,
  };
}

async function setup({ book = {}, deps = {}, speech = {} } = {}) {
  const fake = installFakeSpeech(speech);
  const d = makeDeps(deps);
  const engine = createTtsEngine(d);
  const states = [];
  let state = {};
  const emit = partial => {
    state = { ...state, ...partial };
    states.push(partial);
  };
  const b = { id: 'book-1', type: 'epub', title: 'T', author: 'A', fileBlob: new Blob(['x']), ...book };
  await engine.load(b, emit);
  const api = {
    fake,
    d,
    engine,
    states,
    get state() {
      return state;
    },
    async run(fn) {
      fn();
      await engine.whenIdle();
    },
  };
  return api;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  delete globalThis.speechSynthesis;
  delete globalThis.SpeechSynthesisUtterance;
});

describe('load', () => {
  it('opens the EPUB, skips front matter on a fresh book and reports paused', async () => {
    const t = await setup();
    expect(t.d.readBlob).toHaveBeenCalled();
    expect(t.state).toMatchObject({
      status: 'paused',
      rate: 1,
      chapterIndex: 1,
      chapters: [{ title: 'Chapter 1 of 3' }, { title: 'Title 1' }, { title: 'Chapter 3 of 3' }],
    });
    expect(t.state.readAlong.chunks).toHaveLength(5);
    expect(t.state.readAlong.chunkIndex).toBe(0);
    expect(t.state.chapterDuration).toBeCloseTo(100, 0);
    expect(t.fake.spoken).toHaveLength(0);
  });

  it('resumes from saved progress without skipping front matter', async () => {
    const t = await setup({ book: { progress: { chapterIndex: 2, chunkIndex: 1 } } });
    expect(t.d.findFirstContentChapter).not.toHaveBeenCalled();
    expect(t.state.chapterIndex).toBe(2);
    expect(t.state.readAlong.chunkIndex).toBe(1);
  });

  it('reports a load failure as an error', async () => {
    const t = await setup({ deps: { openEpub: vi.fn(async () => { throw new Error('bad zip'); }) } }).catch(e => e);
    // load() rejects; the store turns the rejection into status:'error'.
    expect(t).toBeInstanceOf(Error);
    expect(t.message).toBe('bad zip');
  });
});

describe('status emits', () => {
  it('says playing only once a chunk actually starts', async () => {
    const t = await setup({ speech: { autoStart: false } });
    await t.run(() => t.engine.play());
    expect(t.state.status).toBe('paused');
    t.fake.start();
    expect(t.state.status).toBe('playing');
  });

  it('says paused on pause', async () => {
    const t = await setup();
    await t.run(() => t.engine.play());
    expect(t.state.status).toBe('playing');
    await t.run(() => t.engine.pause());
    expect(t.state.status).toBe('paused');
  });

  it('says paused with an error message when speech fails', async () => {
    const t = await setup();
    await t.run(() => t.engine.play());
    t.fake.current.onerror({ error: 'synthesis-failed' });
    expect(t.state).toMatchObject({ status: 'paused', error: 'synthesis-failed' });
  });

  it('persists progress when a chunk starts', async () => {
    const t = await setup();
    await t.run(() => t.engine.play());
    t.fake.finish();
    expect(loadEpubProgress('book-1')).toMatchObject({ chapterIndex: 1, chunkIndex: 1 });
    expect(t.d.updateBook).toHaveBeenCalledWith(
      'book-1',
      expect.objectContaining({ progress: expect.objectContaining({ chapterIndex: 1, chunkIndex: 1 }) }),
    );
  });
});

describe('live rate change', () => {
  it('re-speaks the current chunk at the new rate and does not advance', async () => {
    const t = await setup();
    await t.run(() => t.engine.play());
    t.fake.finish(); // now on chunk 1
    expect(t.fake.texts()).toHaveLength(2);

    await t.run(() => t.engine.setRate(1.5));

    expect(t.fake.cancels).toBeGreaterThan(0);
    const texts = t.fake.texts();
    expect(texts).toHaveLength(3);
    expect(texts[2]).toBe(texts[1]); // same chunk again, not chunk 2
    expect(t.fake.spoken[2].rate).toBe(1.5);
    expect(t.state).toMatchObject({ rate: 1.5, status: 'playing' });
    expect(t.state.readAlong.chunkIndex).toBe(1);
    expect(t.d.updateBook).toHaveBeenCalledWith('book-1', { playbackRate: 1.5 });
  });

  it('ignores the stale end event of a cancelled utterance', async () => {
    const t = await setup();
    await t.run(() => t.engine.play());
    const stale = t.fake.current;
    await t.run(() => t.engine.setRate(1.25));
    const before = t.fake.spoken.length;
    stale.onend(); // late event from the cancelled utterance
    stale.onerror({ error: 'interrupted' });
    expect(t.fake.spoken).toHaveLength(before);
    expect(t.state.readAlong.chunkIndex).toBe(0);
  });

  it('while paused only stores the rate', async () => {
    const t = await setup();
    await t.run(() => t.engine.setRate(1.75));
    expect(t.fake.spoken).toHaveLength(0);
    expect(t.state.rate).toBe(1.75);
    await t.run(() => t.engine.play());
    expect(t.fake.spoken[0].rate).toBe(1.75);
  });

  it('clamps to the EPUB maximum', async () => {
    const t = await setup();
    await t.run(() => t.engine.setRate(3));
    expect(t.state.rate).toBe(2);
  });
});

describe('pause and resume', () => {
  it('cancels on pause without advancing, and resume re-speaks the same chunk', async () => {
    const t = await setup();
    await t.run(() => t.engine.play());
    t.fake.finish(); // chunk 1 speaking
    await t.run(() => t.engine.pause());
    expect(t.fake.cancels).toBeGreaterThan(0);
    expect(t.fake.texts()).toHaveLength(2); // the cancel's end event did not advance

    await t.run(() => t.engine.play());
    const texts = t.fake.texts();
    expect(texts).toHaveLength(3);
    expect(texts[2]).toBe(texts[1]);
    expect(t.state.status).toBe('playing');
  });
});

describe('per-book speed', () => {
  it('a new EPUB does not inherit the previous book speed or an old saved default', async () => {
    // An older build wrote the EPUB speed into the global default.
    const staleDefault = () => ({ rate: 1.5, webSpeechVoiceId: '' });
    const router = new TTSRouter();
    const first = await setup({ book: { id: 'one', playbackRate: 1 }, deps: { router, loadSettings: staleDefault } });
    await first.run(() => first.engine.setRate(1.75));
    first.engine.destroy();

    const second = await setup({ book: { id: 'two' }, deps: { router, loadSettings: staleDefault } });
    expect(second.state.rate).toBe(1);
    await second.run(() => second.engine.play());
    expect(second.fake.spoken[0].rate).toBe(1);
  });

  it('restores a book own saved speed, snapped to an offered step', async () => {
    const t = await setup({ book: { playbackRate: 1.3 } });
    expect(t.state.rate).toBe(1.25);
  });

  it('does not change the saved default', async () => {
    const t = await setup();
    await t.run(() => t.engine.setRate(1.5));
    expect(localStorage.getItem('tts-settings')).toBeNull();
  });
});

describe('skip and seek', () => {
  it('moves by whole chunks using the per-chunk estimate (20 s each at 1x)', async () => {
    const t = await setup();
    await t.run(() => t.engine.skip(40));
    expect(t.state.readAlong.chunkIndex).toBe(2);
    await t.run(() => t.engine.skip(-20));
    expect(t.state.readAlong.chunkIndex).toBe(1);
  });

  it('moves at least one chunk for a small skip', async () => {
    const t = await setup();
    await t.run(() => t.engine.skip(5));
    expect(t.state.readAlong.chunkIndex).toBe(1);
  });

  it('while playing, keeps playing from the new chunk', async () => {
    const t = await setup();
    await t.run(() => t.engine.play());
    await t.run(() => t.engine.skip(20));
    expect(t.fake.texts().at(-1)).toBe(CHAPTERS[1][1]);
    expect(t.state.status).toBe('playing');
  });

  it('rolls into the next chapter when skipping past the end', async () => {
    const t = await setup({ book: { progress: { chapterIndex: 1, chunkIndex: 4 } } });
    await t.run(() => t.engine.skip(20));
    expect(t.state.chapterIndex).toBe(2);
    expect(t.state.readAlong.chunkIndex).toBe(0);
  });

  it('rolls back to the previous chapter last chunk when skipping before the start', async () => {
    const t = await setup({ book: { progress: { chapterIndex: 2, chunkIndex: 0 } } });
    await t.run(() => t.engine.skip(-20));
    expect(t.state.chapterIndex).toBe(1);
    expect(t.state.readAlong.chunkIndex).toBe(4);
  });

  it('seekInChapter jumps to chunk floor(f * count)', async () => {
    const t = await setup();
    await t.run(() => t.engine.seekInChapter(0.5));
    expect(t.state.readAlong.chunkIndex).toBe(2);
    await t.run(() => t.engine.seekInChapter(1));
    expect(t.state.readAlong.chunkIndex).toBe(4);
  });

  it('goToChapter loads that chapter from its start', async () => {
    const t = await setup();
    await t.run(() => t.engine.goToChapter(2));
    expect(t.state).toMatchObject({ chapterIndex: 2, status: 'paused' });
    expect(t.state.readAlong.chunks).toHaveLength(2);
  });
});

describe('chapter roll-over', () => {
  it('continues into the next chapter when a chapter finishes', async () => {
    const t = await setup({ book: { progress: { chapterIndex: 1, chunkIndex: 4 } } });
    await t.run(() => t.engine.play());
    t.fake.finish();
    await t.engine.whenIdle();
    expect(t.state.chapterIndex).toBe(2);
    expect(t.fake.texts().at(-1)).toBe(CHAPTERS[2][0]);
    expect(t.state.status).toBe('playing');
  });

  it('marks the book finished after the last chapter', async () => {
    const t = await setup({ book: { progress: { chapterIndex: 2, chunkIndex: 1 } } });
    await t.run(() => t.engine.play());
    t.fake.finish();
    await t.engine.whenIdle();
    expect(t.state.status).toBe('paused');
    expect(t.d.updateBook).toHaveBeenCalledWith('book-1', expect.objectContaining({ finishedAt: expect.any(Number) }));
  });

  it('stops at the end of the chapter when the sleep timer says so', async () => {
    const t = await setup({ book: { progress: { chapterIndex: 1, chunkIndex: 4 } } });
    t.engine.setSleep('chapter');
    expect(t.state.sleep).toEqual({ mode: 'chapter' });
    await t.run(() => t.engine.play());
    const spokenBefore = t.fake.spoken.length;
    t.fake.finish();
    await t.engine.whenIdle();
    expect(t.state.status).toBe('paused');
    expect(t.state.chapterIndex).toBe(2); // parked at the start of the next chapter
    expect(t.state.sleep).toEqual({ mode: 'off' });
    expect(t.fake.spoken).toHaveLength(spokenBefore);
  });

  it('a timed sleep reports its end time and pauses when it runs out', async () => {
    vi.useFakeTimers();
    try {
      const t = await setup();
      await t.run(() => t.engine.play());
      t.engine.setSleep('15');
      expect(t.state.sleep.mode).toBe('15');
      expect(t.state.sleep.endsAt).toBeGreaterThan(Date.now());
      await vi.advanceTimersByTimeAsync(15 * 60_000);
      await t.engine.whenIdle();
      expect(t.state.status).toBe('paused');
      expect(t.state.sleep).toEqual({ mode: 'off' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('setSleep off cancels a running timer', async () => {
    vi.useFakeTimers();
    try {
      const t = await setup();
      await t.run(() => t.engine.play());
      t.engine.setSleep('30');
      t.engine.setSleep('off');
      expect(t.state.sleep).toEqual({ mode: 'off' });
      await vi.advanceTimersByTimeAsync(31 * 60_000);
      expect(t.state.status).toBe('playing');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('destroy', () => {
  it('stops speech and releases the EPUB', async () => {
    const t = await setup();
    await t.run(() => t.engine.play());
    t.engine.destroy();
    expect(t.d.destroyEpub).toHaveBeenCalledWith(t.d.epub);
    expect(t.fake.cancels).toBeGreaterThan(0);
  });
});

describe('word position', () => {
  it('re-speaks from the current word on a speed change', async () => {
    const t = await setup();
    await t.run(() => t.engine.play());
    t.fake.boundary(100);
    await t.run(() => t.engine.setRate(1.5));
    expect(t.fake.texts().at(-1)).toBe(CHAPTERS[1][0].slice(100));
  });

  it('resumes from the current word after pause', async () => {
    const t = await setup();
    await t.run(() => t.engine.play());
    t.fake.boundary(120);
    await t.run(() => t.engine.pause());
    await t.run(() => t.engine.play());
    expect(t.fake.texts().at(-1)).toBe(CHAPTERS[1][0].slice(120));
    expect(t.state.status).toBe('playing');
  });

  it('restarts the chunk on resume when the voice sent no boundaries', async () => {
    const t = await setup();
    await t.run(() => t.engine.play());
    await t.run(() => t.engine.pause());
    await t.run(() => t.engine.play());
    expect(t.fake.texts().at(-1)).toBe(CHAPTERS[1][0]);
  });

  it('saves the character offset and reopening resumes there', async () => {
    const t = await setup();
    await t.run(() => t.engine.play());
    t.fake.boundary(150);
    await t.run(() => t.engine.pause());
    expect(loadEpubProgress('book-1')).toMatchObject({ chapterIndex: 1, chunkIndex: 0, charIndex: 150 });
    t.engine.destroy();

    const again = await setup();
    expect(again.state.chapterElapsed).toBeCloseTo(150 / 13.75, 1);
    await again.run(() => again.engine.play());
    expect(again.fake.texts()[0]).toBe(CHAPTERS[1][0].slice(150));
  });

  it('reads an old save without charIndex as the chunk start', async () => {
    localStorage.setItem('epub-progress:book-1', JSON.stringify({ chapterIndex: 1, chunkIndex: 2, charOffset: 0 }));
    const t = await setup();
    expect(t.state.readAlong.chunkIndex).toBe(2);
    await t.run(() => t.engine.play());
    expect(t.fake.texts()[0]).toBe(CHAPTERS[1][2]);
  });
});

describe('chapter elapsed time', () => {
  it('follows word boundaries across chunks, and elapsed + remaining = duration', async () => {
    const t = await setup();
    await t.run(() => t.engine.play());
    t.fake.boundary(138); // half of chunk 0 = 10 s
    expect(t.state.chapterElapsed).toBeCloseTo(138 / 13.75, 2);
    t.fake.finish(); // chunk 1 starts
    expect(t.state.chapterElapsed).toBeCloseTo(20, 1);
    expect(t.state.chapterDuration).toBeCloseTo(100, 1);
  });

  it('ticks every second between boundaries, scaled by speed', async () => {
    vi.useFakeTimers();
    try {
      const t = await setup({ book: { playbackRate: 1.5 } });
      await t.run(() => t.engine.play());
      expect(t.state.chapterElapsed).toBe(0);
      await vi.advanceTimersByTimeAsync(1000);
      const one = t.state.chapterElapsed;
      expect(one).toBeCloseTo(1, 1); // chars * 1.5 speed, duration shrinks by the same factor
      await vi.advanceTimersByTimeAsync(2000);
      expect(t.state.chapterElapsed).toBeCloseTo(3, 1);
      t.fake.boundary(137); // 137 chars at 1.5x = ~6.6 s
      expect(t.state.chapterElapsed).toBeCloseTo(137 / 13.75 / 1.5, 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ticks when the voice sends no boundaries but never passes the chunk end', async () => {
    vi.useFakeTimers();
    try {
      const t = await setup();
      await t.run(() => t.engine.play());
      await vi.advanceTimersByTimeAsync(5000);
      expect(t.state.chapterElapsed).toBeCloseTo(5, 1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(t.state.chapterElapsed).toBeCloseTo(20, 1); // chunk 0 is 20 s long
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops ticking on pause and resumes ticking on play', async () => {
    vi.useFakeTimers();
    try {
      const t = await setup();
      await t.run(() => t.engine.play());
      await vi.advanceTimersByTimeAsync(3000);
      await t.run(() => t.engine.pause());
      const frozen = t.state.chapterElapsed;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(t.state.chapterElapsed).toBe(frozen);
      await t.run(() => t.engine.play());
      await vi.advanceTimersByTimeAsync(2000);
      expect(t.state.chapterElapsed).toBeGreaterThan(frozen);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops ticking after destroy', async () => {
    vi.useFakeTimers();
    try {
      const t = await setup();
      await t.run(() => t.engine.play());
      t.engine.destroy();
      const n = t.states.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(t.states).toHaveLength(n);
    } finally {
      vi.useRealTimers();
    }
  });
});
