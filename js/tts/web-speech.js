import { registerProviderMeta } from './provider-interface.js';

registerProviderMeta({
  id: 'web-speech',
  name: 'Web Speech (built-in)',
  tier: 'free',
  description: 'Your device’s built-in voice. Always available, no setup.',
});

/**
 * Web Speech API TTS wrapper with play/pause/resume/stop.
 */
export class WebSpeechTTS {
  constructor() {
    /** @type {SpeechSynthesisUtterance|null} */
    this.currentUtterance = null;
    /** @type {string[]} */
    this.queue = [];
    this.queueIndex = 0;
    this.paused = false;
    this.speaking = false;
    /**
     * Bumped whenever the current utterance is cancelled or replaced. Each
     * utterance remembers the value it was created with and ignores its events
     * if it no longer matches (Safari fires `end` after `cancel()`).
     */
    this.generation = 0;
    /**
     * Character offset, within the full current chunk, of the last word the
     * voice reported (or where this chunk was started from). Pause, resume and
     * speed changes speak again from here. Stays 0 for voices that send no
     * boundary events, so those restart the chunk.
     */
    this.charIndex = 0;
    /** @type {((index: number, charIndex: number) => void)|null} index of the chunk, and the offset it (re)started from */
    this.onChunkStart = null;
    /** @type {((index: number, charIndex: number) => void)|null} a word boundary: chunk index and offset in that chunk */
    this.onProgress = null;
    /** @type {(() => void)|null} */
    this.onComplete = null;
    /** @type {((error: Error) => void)|null} */
    this.onError = null;
  }

  /**
   * @param {string[]} chunks
   * @param {number} [startIndex=0]
   * @param {number} [startChar=0] offset inside the first chunk to begin from
   */
  speak(chunks, startIndex = 0, startChar = 0) {
    this.stop(false);
    this.queue = chunks;
    this.queueIndex = startIndex;
    this.charIndex = startChar;
    this.paused = false;
    this.speaking = true;
    this.speakCurrent();
  }

  speakCurrent() {
    if (this.queueIndex >= this.queue.length) {
      this.speaking = false;
      this.onComplete?.();
      return;
    }

    const full = this.queue[this.queueIndex];
    // Say only the rest of the chunk. Never start on nothing: an empty
    // utterance may fire no events at all.
    if (this.charIndex <= 0 || full.slice(this.charIndex).trim() === '') this.charIndex = 0;
    const offset = this.charIndex;
    const text = full.slice(offset);
    const generation = ++this.generation;
    this.currentUtterance = new SpeechSynthesisUtterance(text);
    this.currentUtterance.rate = this.preferredRate ?? 1;

    if (this.preferredVoiceId) {
      const voice = speechSynthesis
        .getVoices()
        .find((v) => v.voiceURI === this.preferredVoiceId);
      if (voice) {
        this.currentUtterance.voice = voice;
      }
    }

    this.currentUtterance.onstart = () => {
      if (generation !== this.generation) return;
      this.onChunkStart?.(this.queueIndex, offset);
    };

    this.currentUtterance.onboundary = (event) => {
      if (generation !== this.generation) return;
      if (event.name && event.name !== 'word') return;
      this.charIndex = offset + (event.charIndex ?? 0);
      this.onProgress?.(this.queueIndex, this.charIndex);
    };

    this.currentUtterance.onend = () => {
      if (generation !== this.generation || this.paused) return;
      this.queueIndex += 1;
      this.charIndex = 0;
      this.speakCurrent();
    };

    this.currentUtterance.onerror = (event) => {
      if (generation !== this.generation) return;
      if (event.error === 'interrupted' || event.error === 'canceled') return;
      this.speaking = false;
      this.onError?.(new Error(event.error || 'Speech synthesis error'));
    };

    speechSynthesis.speak(this.currentUtterance);
  }

  /** Cancel whatever is speaking and make its late events harmless. */
  cancelCurrent() {
    this.generation += 1;
    speechSynthesis.cancel();
  }

  /**
   * iOS pause()/resume() is unreliable, so pausing cancels the utterance and
   * remembers the chunk and the last word reached; resume() speaks from that word
   * (or the chunk start for voices that send no word boundaries).
   */
  pause() {
    if (!this.speaking || this.paused) return;
    this.paused = true;
    this.cancelCurrent();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.speakCurrent();
  }

  /**
   * @param {boolean} [clearQueue=true]
   */
  stop(clearQueue = true) {
    this.cancelCurrent();
    this.paused = false;
    this.speaking = false;
    this.currentUtterance = null;
    if (clearQueue) {
      this.queue = [];
      this.queueIndex = 0;
      this.charIndex = 0;
    }
  }

  /**
   * @returns {{ id: string, name: string }[]}
   */
  listVoices() {
    return speechSynthesis.getVoices().map((v) => ({
      id: v.voiceURI,
      name: `${v.name} (${v.lang})`,
    }));
  }

  /**
   * @param {string} voiceId
   */
  setVoice(voiceId) {
    const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === voiceId);
    if (voice && this.currentUtterance) {
      this.currentUtterance.voice = voice;
    }
    this.preferredVoiceId = voiceId;
  }

  /**
   * @param {number} rate
   */
  setRate(rate) {
    this.preferredRate = rate;
    // An utterance's rate is fixed once it starts, so while speaking, cancel it
    // and say the rest of the current chunk again at the new rate.
    if (this.speaking && !this.paused && this.currentUtterance) {
      this.cancelCurrent();
      this.speakCurrent();
    }
  }

  getCurrentChunkIndex() {
    return this.queueIndex;
  }

  getCharIndex() {
    return this.charIndex;
  }

  isPaused() {
    return this.paused;
  }

  isSpeaking() {
    return this.speaking;
  }
}
