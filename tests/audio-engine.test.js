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

const track = (label, extra = {}) => ({ fileBlob: new Blob(['x']), label, ...extra });

function setup(bookOverrides = {}, depOverrides = {}) {
  const audio = makeFakeAudio();
  const updateBook = vi.fn(() => Promise.resolve());
  const createUrl = vi.fn(() => 'blob:fake');
  const revokeUrl = vi.fn();
  const engine = createAudioEngine({ audio, updateBook, createUrl, revokeUrl, ...depOverrides });
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
  return { audio, engine, states, emit, updateBook, createUrl, revokeUrl, book, last };
}

function ready(audio, duration = 1000) {
  audio.duration = duration;
  audio.dispatchEvent(new Event('loadedmetadata'));
}

describe('createAudioEngine status from <audio> events', () => {
  it('loads paused with the saved rate', () => {
    const { last } = setup({ playbackRate: 1.5 });
    expect(last('status')).toBe('paused');
    expect(last('rate')).toBe(1.5);
  });

  it('emits playing on the playing event and paused on pause', () => {
    const { audio, engine, last } = setup();
    ready(audio);
    engine.play();
    expect(last('status')).toBe('playing');
    audio.pause();
    expect(last('status')).toBe('paused');
  });

  it('does not emit playing when play() rejects', async () => {
    const { audio, engine, states } = setup();
    ready(audio);
    audio.playResult = 'reject';
    engine.play();
    await Promise.resolve();
    await Promise.resolve();
    expect(states.some(s => s.status === 'playing')).toBe(false);
    expect(states.at(-1).status).toBe('paused');
  });

  it('stays playing while buffering, so the Pause button still pauses', () => {
    const { audio, engine, last } = setup();
    ready(audio);
    engine.play();
    audio.dispatchEvent(new Event('playing'));
    audio.dispatchEvent(new Event('waiting'));
    expect(last('status')).toBe('playing');
  });

  it('emits error on the error event', () => {
    const { audio, last } = setup();
    audio.dispatchEvent(new Event('error'));
    expect(last('status')).toBe('error');
    expect(last('error')).toBeTruthy();
  });

  it('marks the book finished and pauses when the last track ends', () => {
    const { audio, engine, last, updateBook } = setup();
    ready(audio);
    engine.play();
    audio.dispatchEvent(new Event('ended'));
    expect(last('status')).toBe('paused');
    expect(updateBook).toHaveBeenCalledWith('b1', expect.objectContaining({ finishedAt: expect.any(Number) }));
  });

  it('rolls into the next track when one ends', () => {
    const { audio, engine, last } = setup({ tracks: [track('A'), track('B')] });
    ready(audio);
    engine.play();
    audio.dispatchEvent(new Event('ended'));
    expect(last('chapterIndex')).toBe(1);
    expect(audio.play).toHaveBeenCalledTimes(2);
  });
});

describe('speed', () => {
  it('re-applies the book speed when the browser resets it on playing', () => {
    const { audio, engine } = setup({ playbackRate: 1.5 });
    ready(audio);
    audio.playbackRate = 1; // iOS reset
    engine.play(); // fake dispatches play + playing
    expect(audio.playbackRate).toBe(1.5);
  });

  it('re-applies on ratechange', () => {
    const { audio } = setup({ playbackRate: 2 });
    audio.playbackRate = 1;
    audio.dispatchEvent(new Event('ratechange'));
    expect(audio.playbackRate).toBe(2);
  });

  it('setRate clamps, applies, saves and emits', () => {
    const { audio, engine, updateBook, last } = setup();
    engine.setRate(1.3);
    expect(audio.playbackRate).toBe(1.25);
    expect(audio.defaultPlaybackRate).toBe(1.25);
    expect(updateBook).toHaveBeenCalledWith('b1', { playbackRate: 1.25 });
    expect(last('rate')).toBe(1.25);
  });
});

describe('skip and seek', () => {
  it('skips within the file and clamps at both ends', () => {
    const { audio, engine } = setup();
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

  it('crosses into the next track carrying the overflow', () => {
    const { audio, engine, last } = setup({ tracks: [track('A'), track('B')] });
    ready(audio, 100);
    audio.currentTime = 95;
    engine.skip(30);
    expect(last('chapterIndex')).toBe(1);
    expect(audio.currentTime).toBe(25);
  });

  it('crosses back into the previous track near its end', () => {
    const { audio, engine, last } = setup({
      tracks: [track('A'), track('B')],
      progress: { trackIndex: 1, seconds: 0 },
    });
    ready(audio, 100);
    audio.currentTime = 5;
    engine.skip(-15);
    expect(last('chapterIndex')).toBe(0);
    ready(audio, 200);
    expect(audio.currentTime).toBe(190);
  });

  it('seekInChapter seeks a fraction of the file', () => {
    const { audio, engine } = setup();
    ready(audio, 200);
    engine.seekInChapter(0.25);
    expect(audio.currentTime).toBe(50);
  });

  it('seekInChapter stays inside an embedded chapter', () => {
    const chapters = [
      { title: 'C1', startSeconds: 0 },
      { title: 'C2', startSeconds: 100 },
    ];
    const { audio, engine, last } = setup({ tracks: [track('A', { chapters })] });
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

  it('emits chapter time and book percent on timeupdate', () => {
    const { audio, last } = setup({ tracks: [track('A'), track('B')] });
    ready(audio, 100);
    audio.currentTime = 50;
    audio.dispatchEvent(new Event('timeupdate'));
    expect(last('chapterElapsed')).toBe(50);
    expect(last('chapterDuration')).toBe(100);
    expect(last('bookPercent')).toBe(25);
  });
});

describe('resume and progress', () => {
  it('resumes 10 s before the saved position', () => {
    const { audio } = setup({ progress: { trackIndex: 0, seconds: 120 } });
    expect(audio.currentTime).toBe(110);
  });

  it('saves nothing until the book has played, then saves on pause', () => {
    const { audio, engine, updateBook } = setup();
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
  it('pauses, revokes the URL, flushes progress and stops listening', () => {
    const { audio, engine, revokeUrl, updateBook, states } = setup();
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
  it('a timed sleep reports its end time, then pauses and clears when it runs out', () => {
    vi.useFakeTimers();
    try {
      const { audio, engine, last } = setup();
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

  it('end of chapter parks at the next track instead of rolling on', () => {
    const { audio, engine, last } = setup({ tracks: [track('A'), track('B')] });
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

  it('end of chapter stops when playback crosses an embedded chapter marker', () => {
    const chapters = [
      { title: 'C1', startSeconds: 0 },
      { title: 'C2', startSeconds: 100 },
    ];
    const { audio, engine, last } = setup({ tracks: [track('A', { chapters })] });
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
