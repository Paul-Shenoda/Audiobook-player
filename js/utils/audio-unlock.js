import { encodeWavBlob } from '../tts/wav-encoder.js';

/**
 * iOS Safari only allows `HTMLMediaElement.play()`/`speechSynthesis.speak()`
 * when they happen essentially synchronously with the user gesture that
 * triggered them. An AI provider's *first* synthesis (loading the runtime,
 * running inference) can take several seconds before it ever calls
 * `audio.play()` — by then Safari no longer honors the original tap and
 * silently drops the call. A Web Speech fallback that follows a failed AI
 * provider is, by construction, also several async hops removed from that
 * same tap, so it hits the identical wall — net effect: true silence, with
 * no error surfaced (WebKit doesn't fire `onerror` for this case either).
 *
 * Call this synchronously at the very top of any click handler that may end
 * up calling `TTSRouter.speak()` (directly, so it never needs importing
 * TTSRouter itself and can be shared by every such call site). Playing an
 * effectively-instant empty utterance and silent clip once per page session
 * "unlocks" both APIs for the rest of the session, so later async-triggered
 * calls are still honored.
 */
let mediaUnlocked = false;
export function unlockMediaForAutoplay() {
  if (mediaUnlocked) return;
  mediaUnlocked = true;
  try {
    speechSynthesis.speak(new SpeechSynthesisUtterance(''));
  } catch {
    // Web Speech unavailable — the <audio> unlock below still helps AI providers.
  }
  try {
    const unlockAudio = new Audio(URL.createObjectURL(encodeWavBlob(new Float32Array(1), 8000)));
    unlockAudio.play().then(
      () => URL.revokeObjectURL(unlockAudio.src),
      () => URL.revokeObjectURL(unlockAudio.src),
    );
  } catch {
    // Nothing more we can do here; playback may still fail on this platform.
  }
}
