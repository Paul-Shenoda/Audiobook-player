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
    /** @type {((index: number) => void)|null} */
    this.onChunkStart = null;
    /** @type {(() => void)|null} */
    this.onComplete = null;
    /** @type {((error: Error) => void)|null} */
    this.onError = null;
  }

  /**
   * @param {string[]} chunks
   * @param {number} [startIndex=0]
   */
  speak(chunks, startIndex = 0) {
    this.stop(false);
    this.queue = chunks;
    this.queueIndex = startIndex;
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

    const text = this.queue[this.queueIndex];
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
      this.onChunkStart?.(this.queueIndex);
    };

    this.currentUtterance.onend = () => {
      if (generation !== this.generation || this.paused) return;
      this.queueIndex += 1;
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
   * remembers the chunk; resume() speaks that chunk again from its start.
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
    // and say the current chunk again at the new rate.
    if (this.speaking && !this.paused && this.currentUtterance) {
      this.cancelCurrent();
      this.speakCurrent();
    }
  }

  getCurrentChunkIndex() {
    return this.queueIndex;
  }

  isPaused() {
    return this.paused;
  }

  isSpeaking() {
    return this.speaking;
  }
}
