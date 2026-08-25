---
type: object
cluster: tts
universe: live
status: verified — 2026-08-25, commit 3248c21
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
  `clearEpubProgress(bookId)` — `{chapterIndex, chunkIndex, charOffset}`
- `estimatePercent(chapterIndex, totalChapters, chunkIndex, totalChunks)` —
  the book-wide percent shown next to the chapter selector
- `estimateSecondsRemaining(chunks, chunkIndex, rate)` — the "X min left in
  chapter" estimate (character-count heuristic — Web Speech has no true
  audio duration to measure against)

Citations: `js/tts/playback-state.js:14,27,34,45,65`

## Connected to

- **owns:** nothing
- **owned-by:** `localStorage['epub-progress:<bookId>']`
- **joins:** `Book.progress` (written together from
  `js/views/epub-listen.js`'s `persistProgress()`, but never read from each
  other — see [../CONTEXT.md](../CONTEXT.md) name collisions)
- **looks-like-but-is-not:** `Book.progress` — same book, same moment
  in time, deliberately two homes for two different granularities. Do not
  collapse these into one record; the library grid and the reading engine
  ask different questions of it.

## If you change this

- **Hits:** `js/views/epub-listen.js` (`updateProgressDisplay`,
  `persistProgress`, chunk skip/seek logic all depend on this shape).
- **Does not hit:** `js/views/mp3-player.js` (MP3 playback has its own
  simpler `Book.progress.seconds` field and never touches this file).

## Surfaces

| Surface | Role |
|---|---|
| `js/views/epub-listen.js` | reads (resume), writes (every chunk start) |

## See

- Source: `js/tts/playback-state.js`
