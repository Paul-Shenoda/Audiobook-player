---
type: process
status: verified — 2026-08-25, commit 9cd694a
consumes: [Book]
produces: [Book.progress, Book.bookmarks]
---

# play-mp3

Plays an mp3-type `Book`'s track(s) via a native `<audio>` element — no
TTS, no provider chain, no chunking.

## Input → Movement → Output

`js/views/mp3-player.js` loads `book.tracks[trackIndex].fileBlob` as an
object URL and sets it as `<audio id="main-audio">`'s `src`, driving
play/pause/±15s-skip/sleep-timer/bookmarks directly against the audio
element's native API — writing `Book.progress.{trackIndex,seconds}`
periodically and `Book.bookmarks` on demand. A book with more than one
track (chapter-per-file, from
[combine-audiobook](combine-audiobook.md)) rolls continuously from one
track's end into the next, same as a book whose single track carries
in-file M4B chapter markers rolls continuously across those without ever
reloading `src`.

## Why this shape

This is deliberately the simplest path in the app: real audio files have a
real seekable timeline, so there's no need for the chunking/provider-chain
machinery `listen-epub` requires for synthesized speech. Keeping it a
separate file (rather than a `TTSProvider`-shaped abstraction over
`<audio>`) avoids forcing an artificial common interface onto two
fundamentally different playback models.

Two independent "chapter" models share one picker UI (the same
`.chapter-sheet` component `listen-epub` uses) without sharing storage or
jump mechanics:

- **Track chapters** (`totalTracks > 1`) — each chapter is its own file.
  Picking one calls `loadTrack(index)`, which reassigns `player.src`.
- **In-file chapters** (`totalTracks === 1 && tracks[0].chapters`) — an
  M4B's embedded chapter markers, read at import time by
  `readM4bChapters()` (see [import-books](import-books.md)). Picking one
  just sets `player.currentTime`; `player.src` never changes. Which model
  is active is decided once, at render time, from `book.tracks` — a book
  never has both.

## Steps

1. `loadTrack(trackIndex, { seconds })` creates the object URL and sets
   `<audio>`'s `src`; called once at open (resuming near the saved
   position) and again on every track change. `js/views/mp3-player.js:143-152`
2. `updateFileChapterLabel()` recomputes which in-file chapter the
   playhead is in on every `timeupdate` and updates the label only when it
   actually changes. `:112-128`
3. Play/pause/skip ±15s operate directly on `player.currentTime`/`.play()`/
   `.pause()`; skipping past a track boundary calls `loadTrack()` on the
   adjacent track with the overflow/underflow seconds carried over.
   `:174-251`
4. `goPrevChapter`/`goNextChapter` (wired to `initMediaSession`'s
   previous/next-track hardware controls) branch on which chapter model is
   active. `:253-280`
5. `openChapterSheet()` renders the same picker for either model via
   `chapterSheetItems()`, which returns track entries or in-file-chapter
   entries depending on which is active. `:282-334`
6. `addBookmarkHere()`/`jumpToBookmark()`/`removeBookmark()` manage
   `Book.bookmarks` from a second sheet reusing the same
   `.chapter-sheet` component. `:344-430`
7. `timeupdate` listener throttles `saveProgress()` (writes
   `Book.progress.{trackIndex,seconds,percent}`) every ~2s, via
   `estimatePercent()` — shared with `listen-epub`'s chapter-weighted
   percent, and mathematically identical to a plain time-fraction when
   `totalTracks === 1`. `:469-484`

## If you change this

- **Hits:** `js/services/media-session.js` (lock-screen controls read from
  this player's real `currentTime`/`duration`, and previous/next-track
  buttons call `goPrevChapter`/`goNextChapter`), `PlaybackManager`
  (`setActive`/`setPlaying`/`setPaused`), `js/utils/series-label.js`
  (series display), `js/utils/toast.js` (bookmark add/remove feedback).
- **Does not hit:** anything in `js/tts/` — this process never imports from
  that directory.

## Surfaces

| Surface | Role |
|---|---|
| `js/views/mp3-player.js` | runs the whole process |
| `js/services/media-session.js` | reads position/duration for lock screen, drives prev/next-chapter |

## See

- Objects: [../objects/book.md](../objects/book.md),
  [../objects/playback-manager.md](../objects/playback-manager.md)
- Processes: [import-books.md](import-books.md), [combine-audiobook.md](combine-audiobook.md)
- Source: `js/views/mp3-player.js`
