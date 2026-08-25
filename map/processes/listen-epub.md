---
type: process
status: verified — 2026-08-25, commit 3248c21
consumes: [TTSSettings, EpubProgress]
produces: [ChunkCache entries, EpubProgress, Book.progress]
---

# listen-epub

Turns one EPUB chapter's extracted text into spoken audio, chunk by chunk,
trying each provider in the user's configured chain before falling back to
the built-in voice.

## Input → Movement → Output

`epub-listen.js` splits chapter text into ~2000-char chunks
(`js/epub/text-extract.js` `chunkText`) and calls `TTSRouter.speak()`; the
router synthesizes (or fetches cached) audio per chunk through the active
provider, prefetching the next chunk while the current one plays, and
persists `EpubProgress`/`Book.progress` on every chunk start.

## Why this shape

Chunking (rather than synthesizing a whole chapter as one request) is what
makes the fallback chain and the tap-to-seek/skip-by-segment UI both
possible — the atomic unit that can be resynthesized by a *different*
provider mid-chapter is one chunk, not the whole chapter.

## Steps

1. `TTSRouter.configure(settings)` builds `providerChain` from
   `TTSSettings.providerChain` via the registry. `js/tts/tts-router.js:118-127`
2. `speak(chunks, startIndex, {bookId, chapterIndex})` starts `playAIChunk()`
   if any provider is configured, else `playWebSpeech()`. `:130-144`
3. `getChunkAudio(index)` checks `ChunkCache` first, then calls
   `aiProvider.synthesize()`, caching the result. `:187-206`
4. On `TTSQuotaExceededError` **and** more chain left, `chainIndex`
   advances, `onProviderFallback` fires (Settings/reading UI can toast it),
   and the *same chunk* retries on the next provider — no chunk is skipped.
   `:260-266`
5. Any other error → `fallbackToWebSpeech()`, chain cleared for the rest of
   the session. `:158-171`
6. `onChunkStart` fires `updateProgressDisplay`/`persistProgress` in
   `js/views/epub-listen.js`, writing both `EpubProgress` and
   `Book.progress`.

## If you change this

- **Hits:** every `TTSProvider` (must throw `TTSQuotaExceededError`
  specifically for quota, not a plain `Error`, or the chain won't advance),
  `js/tts/chunk-cache.js`, `js/tts/playback-state.js`.
- **Does not hit:** `js/views/mp3-player.js` — MP3 playback is a completely
  separate native-`<audio>` path, this process never runs for it.

## Surfaces

| Surface | Role |
|---|---|
| `js/views/epub-listen.js` | drives the UI, owns chunk/chapter indices |
| `js/tts/tts-router.js` | runs the chain/fallback logic |

## See

- Objects: [../objects/tts-provider.md](../objects/tts-provider.md),
  [../objects/tts-settings.md](../objects/tts-settings.md),
  [../objects/chunk-cache.md](../objects/chunk-cache.md),
  [../objects/epub-progress.md](../objects/epub-progress.md)
- Source: `js/tts/tts-router.js`, `js/views/epub-listen.js`
