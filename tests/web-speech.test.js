import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSpeechTTS } from '../js/tts/web-speech.js';

/** Speech synthesis that records utterances and lets a test fire boundary events. */
function installFakeSpeech() {
  const fake = {
    spoken: [],
    current: null,
    speak(u) {
      fake.spoken.push(u);
      fake.current = u;
      u.onstart?.();
    },
    cancel() {
      const u = fake.current;
      fake.current = null;
      u?.onend?.(); // Safari fires end after cancel
    },
    boundary(charIndex, name = 'word') {
      fake.current?.onboundary?.({ charIndex, name });
    },
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

const CHUNKS = ['The quick brown fox jumps over', 'the lazy dog again and again'];

let fake;
beforeEach(() => {
  fake = installFakeSpeech();
});
afterEach(() => {
  delete globalThis.speechSynthesis;
  delete globalThis.SpeechSynthesisUtterance;
});

describe('WebSpeechTTS word position', () => {
  it('reports the character offset of each word boundary', () => {
    const tts = new WebSpeechTTS();
    const progress = [];
    tts.onProgress = (i, c) => progress.push([i, c]);
    tts.speak(CHUNKS);
    fake.boundary(4);
    fake.boundary(10);
    expect(progress).toEqual([[0, 4], [0, 10]]);
  });

  it('ignores sentence boundaries', () => {
    const tts = new WebSpeechTTS();
    const progress = [];
    tts.onProgress = (i, c) => progress.push([i, c]);
    tts.speak(CHUNKS);
    fake.boundary(10, 'sentence');
    expect(progress).toEqual([]);
  });

  it('resumes after pause from the start of the current word', () => {
    const tts = new WebSpeechTTS();
    tts.speak(CHUNKS);
    fake.boundary(10);
    tts.pause();
    tts.resume();
    expect(fake.texts().at(-1)).toBe(CHUNKS[0].slice(10));
  });

  it('re-speaks from the current word when the rate changes', () => {
    const tts = new WebSpeechTTS();
    tts.speak(CHUNKS);
    fake.boundary(16);
    tts.setRate(1.5);
    expect(fake.texts().at(-1)).toBe(CHUNKS[0].slice(16));
    expect(fake.spoken.at(-1).rate).toBe(1.5);
  });

  it('keeps offsets relative to the full chunk after a re-speak', () => {
    const tts = new WebSpeechTTS();
    const progress = [];
    tts.onProgress = (i, c) => progress.push([i, c]);
    tts.speak(CHUNKS);
    fake.boundary(10);
    tts.setRate(1.5); // now speaking chunk.slice(10)
    fake.boundary(6); // 6 chars into the slice
    expect(progress.at(-1)).toEqual([0, 16]);
    tts.pause();
    tts.resume();
    expect(fake.texts().at(-1)).toBe(CHUNKS[0].slice(16));
  });

  it('restarts the chunk when the voice sent no boundary events', () => {
    const tts = new WebSpeechTTS();
    tts.speak(CHUNKS);
    tts.setRate(1.5);
    expect(fake.texts().at(-1)).toBe(CHUNKS[0]);
    tts.pause();
    tts.resume();
    expect(fake.texts().at(-1)).toBe(CHUNKS[0]);
  });

  it('starts the next chunk from its beginning', () => {
    const tts = new WebSpeechTTS();
    tts.speak(CHUNKS);
    fake.boundary(10);
    fake.finish();
    expect(fake.texts().at(-1)).toBe(CHUNKS[1]);
    tts.setRate(1.25);
    expect(fake.texts().at(-1)).toBe(CHUNKS[1]);
  });

  it('can start mid-chunk and reports where that chunk started', () => {
    const tts = new WebSpeechTTS();
    const starts = [];
    tts.onChunkStart = (i, c) => starts.push([i, c]);
    tts.speak(CHUNKS, 0, 10);
    expect(fake.texts()[0]).toBe(CHUNKS[0].slice(10));
    expect(starts).toEqual([[0, 10]]);
  });

  it('ignores boundary events of a cancelled utterance', () => {
    const tts = new WebSpeechTTS();
    const progress = [];
    tts.onProgress = (i, c) => progress.push([i, c]);
    tts.speak(CHUNKS);
    const stale = fake.current;
    tts.setRate(1.5);
    stale.onboundary({ charIndex: 20, name: 'word' });
    expect(progress).toEqual([]);
  });
});
