/**
 * iOS Safari only allows `speechSynthesis.speak()` when it happens essentially
 * synchronously with the user gesture that triggered it. EPUB read-aloud starts
 * after several async steps (loading the book, queued commands), so by then
 * Safari no longer honors the original tap and silently drops the call.
 *
 * Call this synchronously at the very top of any click handler that may end
 * up starting speech. Speaking an empty utterance once per page session
 * "unlocks" speech for the rest of the session.
 */
let mediaUnlocked = false;
export function unlockMediaForAutoplay() {
  if (mediaUnlocked) return;
  mediaUnlocked = true;
  try {
    speechSynthesis.speak(new SpeechSynthesisUtterance(''));
  } catch {
    // Web Speech unavailable: nothing to unlock.
  }
}
