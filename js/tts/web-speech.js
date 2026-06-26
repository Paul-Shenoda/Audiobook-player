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
      this.onChunkStart?.(this.queueIndex);
    };

    this.currentUtterance.onend = () => {
      if (this.paused) return;
      this.queueIndex += 1;
      this.speakCurrent();
    };

    this.currentUtterance.onerror = (event) => {
      if (event.error === 'interrupted' || event.error === 'canceled') return;
      this.speaking = false;
      this.onError?.(new Error(event.error || 'Speech synthesis error'));
    };

    speechSynthesis.speak(this.currentUtterance);
  }

  pause() {
    if (!this.speaking) return;
    speechSynthesis.pause();
    this.paused = true;
  }

  resume() {
    if (!this.paused) return;
    speechSynthesis.resume();
    this.paused = false;
  }

  /**
   * @param {boolean} [clearQueue=true]
   */
  stop(clearQueue = true) {
    speechSynthesis.cancel();
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
    if (this.currentUtterance) {
      this.currentUtterance.rate = rate;
    }
    this.preferredRate = rate;
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
