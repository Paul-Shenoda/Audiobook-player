import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Minimal fake Worker: captures posted messages and lets tests drive
 * onmessage/onerror directly, so we can exercise callWorker's inactivity
 * timeout without a real Worker/kokoro-js/WASM stack (unavailable in jsdom).
 */
class FakeWorker {
  constructor() {
    this.posted = [];
    this.onmessage = null;
    this.onerror = null;
  }
  postMessage(msg) {
    this.posted.push(msg);
  }
}

describe('kokoro-tts worker call timeout', () => {
  /** @type {FakeWorker} */
  let fakeWorker;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    fakeWorker = new FakeWorker();
    vi.stubGlobal('Worker', vi.fn(() => fakeWorker));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('resolves normally when the worker responds before the timeout', async () => {
    const { downloadKokoroModel } = await import('../js/tts/kokoro-tts.js');

    const promise = downloadKokoroModel();
    await vi.advanceTimersByTimeAsync(1000);
    const { id } = fakeWorker.posted[0];
    fakeWorker.onmessage({ data: { id, type: 'loaded' } });

    await expect(promise).resolves.toBeUndefined();
  });

  it('rejects with the original error when the worker reports one', async () => {
    const { downloadKokoroModel } = await import('../js/tts/kokoro-tts.js');

    const promise = downloadKokoroModel();
    const { id } = fakeWorker.posted[0];
    fakeWorker.onmessage({ data: { id, type: 'error', error: 'boom' } });

    await expect(promise).rejects.toThrow('boom');
  });

  it('rejects with a timeout error after 60s of total silence from the worker', async () => {
    const { downloadKokoroModel } = await import('../js/tts/kokoro-tts.js');

    const promise = downloadKokoroModel();
    const assertion = expect(promise).rejects.toThrow(/took too long/);
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });

  it('does not time out while progress events keep arriving, even past 60s total', async () => {
    const { downloadKokoroModel } = await import('../js/tts/kokoro-tts.js');
    const onProgress = vi.fn();

    const promise = downloadKokoroModel(onProgress);
    const { id } = fakeWorker.posted[0];

    // Three progress pings 40s apart (120s total) — each should reset the
    // 60s inactivity window, so none of them should let it expire.
    for (let i = 0; i < 3; i += 1) {
      await vi.advanceTimersByTimeAsync(40_000);
      fakeWorker.onmessage({ data: { id, type: 'progress', progress: { status: 'progress', progress: i * 30 } } });
    }
    fakeWorker.onmessage({ data: { id, type: 'loaded' } });

    await expect(promise).resolves.toBeUndefined();
    expect(onProgress).toHaveBeenCalledTimes(3);
  });

  it('rejects every pending call when the worker itself errors out', async () => {
    const { downloadKokoroModel } = await import('../js/tts/kokoro-tts.js');

    const promise = downloadKokoroModel();
    fakeWorker.onerror({ message: 'script failed to load' });

    await expect(promise).rejects.toThrow(/falling back to the built-in voice/);
  });
});
