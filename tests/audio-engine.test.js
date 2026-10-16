import { describe, it, expect, vi } from 'vitest';
import { createAudioEngine } from '../js/engines/audio-engine.js';

/** A fake <audio>: an EventTarget whose play()/pause() dispatch the events a browser would. */
function makeFakeAudio() {
  const audio = new EventTarget();
  Object.assign(audio, {
    paused: true,
    currentTime: 0,
    duration: NaN,
    playbackRate: 1,
    defaultPlaybackRate: 1,
    src: '',
    playResult: 'ok', // 'ok' | 'reject'
    play: vi.fn(() => {
      if (audio.playResult === 'reject') return Promise.reject(new Error('NotAllowedError'));
      audio.paused = false;
      audio.dispatchEvent(new Event('play'));
      audio.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    }),
    pause: vi.fn(() => {
      if (audio.paused) return;
      audio.paused = true;
      audio.dispatchEvent(new Event('pause'));
    }),
    removeAttribute: vi.fn(() => {
      audio.src = '';
    }),
    load: vi.fn(),
  });
  return audio;
}

const track = (label, extra = {}) => ({ fileKey: `key:${label}`, label, ...extra });

async function setup(bookOverrides = {}, depOverrides = {}) {
  const audio = makeFakeAudio();
  const updateBook = vi.fn(() => Promise.resolve());
  const getTrackFile = vi.fn(() => Promise.resolve(new Blob(['x'])));
  const createUrl = vi.fn(() => 'blob:fake');
  const revokeUrl = vi.fn();
  const engine = createAudioEngine({ audio, updateBook, getTrackFile, createUrl, revokeUrl, ...depOverrides });
  const states = [];
  const emit = partial => states.push(partial);
  const book = {
    id: 'b1',
    type: 'mp3',
    title: 'T',
    tracks: [track('One')],
    ...bookOverrides,
  };
  const last = key => [...states].reverse().find(s => key in s)?.[key];
  engine.load(book, emit);
  await flush();
  return { audio, engine, states, emit, updateBook, getTrackFile, createUrl, revokeUrl, book, last };
}

/** Let the engine's database read for the current file finish. */
async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function ready(audio, duration = 1000) {
  audio.duration = duration;
  audio.dispatchEvent(new Event('loadedmetadata'));
}

describe('createAudioEngine status from <audio> events', () => {
  it('loads paused with the saved rate', async () => {
    const { last } = await setup({ playbackRate: 1.5 });
    expect(last('status')).toBe('paused');
    expect(last('rate')).toBe(1.5);
  });

  it('emits playing on the playing event and paused on pause', async () => {
    const { audio, engine, last } = await setup();
    ready(audio);
    engine.play();
    expect(last('status')).toBe('playing');
    audio.pause();
    expect(last('status')).toBe('paused');
  });

  it('does not emit playing when play() rejects', async () => {
    const { audio, engine, states } = await setup();
    ready(audio);
    audio.playResult = 'reject';
    engine.play();
    await Promise.resolve();
    await Promise.resolve();
    expect(states.some(s => s.status === 'playing')).toBe(false);
    expect(states.at(-1).status).toBe('paused');
  });

  it('stays playing while buffering, so the Pause button still pauses', async () => {
    const { audio, engine, last } = await setup();
    ready(audio);
    engine.play();
    audio.dispatchEvent(new Event('playing'));
    audio.dispatchEvent(new Event('waiting'));
    expect(last('status')).toBe('playing');
  });

  it('emits error on the error event', async () => {
    const { audio, last } = await setup();
    audio.dispatchEvent(new Event('error'));
    expect(last('status')).toBe('error');
    expect(last('error')).toBeTruthy();
  });

  it('marks the book finished and pauses when the last track ends', async () => {
    const { audio, engine, last, updateBook } = await setup();
    ready(audio);
    engine.play();
    audio.dispatchEvent(new Event('ended'));
    expect(last('status')).toBe('paused');
    expect(updateBook).toHaveBeenCalledWith('b1', expect.objectContaining({ finishedAt: expect.any(Number) }));
  });

  it('rolls into the next track when one ends', async () => {
    const { audio, engine, last } = await setup({ tracks: [track('A'), track('B')] });
    ready(audio);
    engine.play();
    audio.dispatchEvent(new Event('ended'));
    expect(last('chapterIndex')).toBe(1);
    await flush();
    expect(audio.play).toHaveBeenCalledTimes(2);
  });
});

describe('speed', () => {
  it('re-applies the book speed when the browser resets it on playing', async () => {
    const { audio, engine } = await setup({ playbackRate: 1.5 });
    ready(audio);
    audio.playbackRate = 1; // iOS reset
    engine.play(); // fake dispatches play + playing
    expect(audio.playbackRate).toBe(1.5);
  });

  it('re-applies on ratechange', async () => {
    const { audio } = await setup({ playbackRate: 2 });
    audio.playbackRate = 1;
    audio.dispatchEvent(new Event('ratechange'));
    expect(audio.playbackRate).toBe(2);
  });

  it('setRate clamps, applies, saves and emits', async () => {
    const { audio, engine, updateBook, last } = await setup();
    engine.setRate(1.3);
    expect(audio.playbackRate).toBe(1.25);
    expect(audio.defaultPlaybackRate).toBe(1.25);
    expect(updateBook).toHaveBeenCalledWith('b1', { playbackRate: 1.25 });
    expect(last('rate')).toBe(1.25);
  });
});

describe('skip and seek', () => {
  it('skips within the file and clamps at both ends', async () => {
    const { audio, engine } = await setup();
    ready(audio, 100);
    audio.currentTime = 50;
    engine.skip(30);
    expect(audio.currentTime).toBe(80);
    engine.skip(30);
    expect(audio.currentTime).toBe(100);
    audio.currentTime = 5;
    engine.skip(-15);
    expect(audio.currentTime).toBe(0);
  });

  it('crosses into the next track carrying the overflow', async () => {
    const { audio, engine, last } = await setup({ tracks: [track('A'), track('B')] });
    ready(audio, 100);
    audio.currentTime = 95;
    engine.skip(30);
    await flush();
    expect(last('chapterIndex')).toBe(1);
    expect(audio.currentTime).toBe(25);
  });

  it('crosses back into the previous track near its end', async () => {
    const { audio, engine, last } = await setup({
      tracks: [track('A'), track('B')],
      progress: { trackIndex: 1, seconds: 0 },
    });
    ready(audio, 100);
    audio.currentTime = 5;
    engine.skip(-15);
    expect(last('chapterIndex')).toBe(0);
    await flush();
    ready(audio, 200);
    expect(audio.currentTime).toBe(190);
  });

  it('seekInChapter seeks a fraction of the file', async () => {
    const { audio, engine } = await setup();
    ready(audio, 200);
    engine.seekInChapter(0.25);
    expect(audio.currentTime).toBe(50);
  });

  it('seekInChapter stays inside an embedded chapter', async () => {
    const chapters = [
      { title: 'C1', startSeconds: 0 },
      { title: 'C2', startSeconds: 100 },
    ];
    const { audio, engine, last } = await setup({ tracks: [track('A', { chapters })] });
    ready(audio, 300);
    engine.goToChapter(1);
    expect(audio.currentTime).toBe(100);
    expect(last('chapterIndex')).toBe(1);
    engine.seekInChapter(0.5);
    expect(audio.currentTime).toBe(200);
    expect(last('chapterDuration')).toBe(200);
    expect(last('chapters')).toEqual([
      { title: 'C1', duration: 100 },
      { title: 'C2', duration: 200 },
    ]);
  });

  it('emits chapter time and book percent on timeupdate', async () => {
    const { audio, last } = await setup({ tracks: [track('A'), track('B')] });
    ready(audio, 100);
    audio.currentTime = 50;
    audio.dispatchEvent(new Event('timeupdate'));
    expect(last('chapterElapsed')).toBe(50);
    expect(last('chapterDuration')).toBe(100);
    expect(last('bookPercent')).toBe(25);
  });
});

describe('resume and progress', () => {
  it('resumes 10 s before the saved position', async () => {
    const { audio } = await setup({ progress: { trackIndex: 0, seconds: 120 } });
    expect(audio.currentTime).toBe(110);
  });

  it('saves nothing until the book has played, then saves on pause', async () => {
    const { audio, engine, updateBook } = await setup();
    ready(audio, 100);
    audio.dispatchEvent(new Event('seeked'));
    expect(updateBook).not.toHaveBeenCalled();
    engine.play();
    audio.currentTime = 30;
    audio.pause();
    expect(updateBook).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ progress: expect.objectContaining({ trackIndex: 0, seconds: 30 }) }),
    );
  });
});

describe('destroy', () => {
  it('pauses, revokes the URL, flushes progress and stops listening', async () => {
    const { audio, engine, revokeUrl, updateBook, states } = await setup();
    ready(audio, 100);
    engine.play();
    audio.currentTime = 40;
    const before = updateBook.mock.calls.length;
    engine.destroy();
    expect(audio.paused).toBe(true);
    expect(revokeUrl).toHaveBeenCalled();
    expect(updateBook.mock.calls.length).toBeGreaterThan(before);

    const emitted = states.length;
    const saves = updateBook.mock.calls.length;
    audio.dispatchEvent(new Event('playing'));
    audio.dispatchEvent(new Event('timeupdate'));
    audio.dispatchEvent(new Event('pause'));
    expect(states.length).toBe(emitted);
    expect(updateBook.mock.calls.length).toBe(saves);
  });
});

describe('sleep timer', () => {
  it('a timed sleep reports its end time, then pauses and clears when it runs out', async () => {
    vi.useFakeTimers();
    try {
      const { audio, engine, last } = await setup();
      ready(audio);
      engine.play();
      engine.setSleep('15');
      expect(last('sleep').mode).toBe('15');
      expect(last('sleep').endsAt).toBeGreaterThan(Date.now());
      vi.advanceTimersByTime(15 * 60_000);
      expect(audio.paused).toBe(true);
      expect(last('status')).toBe('paused');
      expect(last('sleep')).toEqual({ mode: 'off' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('end of chapter parks at the next track instead of rolling on', async () => {
    const { audio, engine, last } = await setup({ tracks: [track('A'), track('B')] });
    ready(audio);
    engine.play();
    engine.setSleep('chapter');
    expect(last('sleep')).toEqual({ mode: 'chapter' });
    audio.dispatchEvent(new Event('ended'));
    expect(last('chapterIndex')).toBe(1);
    expect(last('status')).toBe('paused');
    expect(last('sleep')).toEqual({ mode: 'off' });
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it('end of chapter stops when playback crosses an embedded chapter marker', async () => {
    const chapters = [
      { title: 'C1', startSeconds: 0 },
      { title: 'C2', startSeconds: 100 },
    ];
    const { audio, engine, last } = await setup({ tracks: [track('A', { chapters })] });
    ready(audio, 300);
    engine.play();
    engine.setSleep('chapter');
    audio.currentTime = 99;
    audio.dispatchEvent(new Event('timeupdate'));
    expect(audio.paused).toBe(false);
    audio.currentTime = 100.2;
    audio.dispatchEvent(new Event('timeupdate'));
    expect(audio.paused).toBe(true);
    expect(audio.currentTime).toBe(100);
    expect(last('sleep')).toEqual({ mode: 'off' });
  });
});

describe('reading track files', () => {
  it('reads each track fresh from the database using its key when it loads', async () => {
    const { audio, engine, getTrackFile, createUrl } = await setup({ tracks: [track('A'), track('B')] });
    expect(getTrackFile).toHaveBeenLastCalledWith('b1', 'key:A');
    expect(createUrl).toHaveBeenCalledTimes(1);
    ready(audio);
    engine.play();
    audio.dispatchEvent(new Event('ended'));
    await flush();
    expect(getTrackFile).toHaveBeenCalledTimes(2);
    expect(getTrackFile).toHaveBeenLastCalledWith('b1', 'key:B');
    expect(createUrl).toHaveBeenCalledTimes(2);
  });

  it('reports an error when the file is missing, and drops a read for a track it already left', async () => {
    const missing = await setup({}, { getTrackFile: vi.fn(() => Promise.resolve(undefined)) });
    expect(missing.last('status')).toBe('error');

    let release;
    const slow = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const t = await setup({ tracks: [track('A'), track('B')] }, { getTrackFile: slow });
    const firstRelease = release;
    t.engine.goToChapter(1);
    firstRelease(new Blob(['a']));
    await flush();
    expect(t.createUrl).not.toHaveBeenCalled();
    release(new Blob(['b']));
    await flush();
    expect(t.createUrl).toHaveBeenCalledTimes(1);
  });
});
