---
type: process
status: updated — 2026-10-16 (AI narration removed)
consumes: [TTSSettings, EpubProgress]
produces: [EpubProgress, Book.progress]
---

# listen-epub

Experimental. Reads one EPUB chapter's text aloud, chunk by chunk, with the
device's built-in voice (Web Speech). The voice stops when the phone locks or
the app is left.

## Input → Movement → Output

`js/engines/tts-engine.js` splits chapter text into chunks
(`js/epub/text-extract.js` `chunkText`) and calls `TTSRouter.speak()`, which
hands them to `WebSpeechTTS`. Word-boundary events report the position;
the engine saves `EpubProgress` (chunk + character) and `Book.progress`.

## Steps

1. `load()` configures the router with the saved settings and the book's own
   speed, opens the EPUB and parks at the saved chapter/chunk/word.
2. `play()` calls `router.speak(chunks, index, { startChar })`.
3. `onChunkStart` / `onProgress` move the position; a ticker interpolates
   elapsed time between words.
4. Pause cancels the utterance and remembers the last word; resume and speed
   changes speak again from that word.
5. `onComplete` rolls into the next chapter (or stops at the end / for the
   sleep timer).

## If you change this

- **Hits:** `js/tts/web-speech.js`, `js/tts/tts-router.js`,
  `js/tts/playback-state.js`, `js/epub/*`.
- **Does not hit:** audio books (`js/engines/audio-engine.js`), which use a
  native `<audio>` element.

## See

- Objects: [../objects/tts-settings.md](../objects/tts-settings.md),
  [../objects/epub-progress.md](../objects/epub-progress.md)
- Source: `js/engines/tts-engine.js`, `js/tts/tts-router.js`
