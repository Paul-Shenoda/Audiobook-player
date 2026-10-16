---
type: object
cluster: tts
universe: live
status: updated — 2026-10-16 (player-store + engines restructure)
entity: js/tts/playback-state.js
---

# EpubProgress

The fine-grained "which exact text chunk was playing" record for an EPUB
book, kept in `localStorage` (not IndexedDB) — separate from and more
precise than `Book.progress`.

## Why this shape

Reading engines need to resume exactly where audio stopped — down to the
chunk (a ~2000-char text segment) — but the library grid only needs a coarse
percent to draw a progress bar. Splitting these avoids writing the heavier
`Book` IndexedDB record on every chunk boundary during playback; only
`EpubProgress` is written that often, `Book.progress` is written alongside
it but read far less frequently.

## Shape

- `loadEpubProgress(bookId)` / `saveEpubProgress(bookId, progress)` /
  `clearEpubProgress(bookId)` — `{chapterIndex, chunkIndex, charIndex?}`
  (`charIndex` is the word position inside the chunk; absent in older saves,
  which resume from the chunk start)
- `estimatePercent(chapterIndex, totalChapters, chunkIndex, totalChunks)` —
  the book-wide percent shown next to the chapter selector
- `estimateSecondsRemaining`, `estimateSecondsForChars`,
  `estimateCharsForSeconds` — the chapter duration/elapsed estimates
  (character-count heuristic — Web Speech has no true audio duration)

Citations: `js/tts/playback-state.js:14,27,34,45,65,79,89`

## Connected to

- **owns:** nothing
- **owned-by:** `localStorage['epub-progress:<bookId>']`
- **joins:** `Book.progress` (written together from the TTS engine's
  `persistProgress()`, `js/engines/tts-engine.js:176-184`; on load the engine
  prefers `EpubProgress` and falls back to `Book.progress`, `:326` — see [../CONTEXT.md](../CONTEXT.md) name collisions)
- **looks-like-but-is-not:** `Book.progress` — same book, same moment
  in time, deliberately two homes for two different granularities. Do not
  collapse these into one record; the library grid and the reading engine
  ask different questions of it.

## If you change this

- **Hits:** `js/engines/tts-engine.js` (`load`, `persistProgress`, chunk
  skip/seek and resume depend on this shape); `js/engines/audio-engine.js`
  imports only `estimatePercent` from this file.
- **Does not hit:** audio resume (`Book.progress.{trackIndex,seconds}`
  written by `js/engines/audio-engine.js`; never reads `EpubProgress`).

## Surfaces

| Surface | Role |
|---|---|
| `js/engines/tts-engine.js` | reads (resume), writes (chunk start, word progress) |

## See

- Source: `js/tts/playback-state.js`
