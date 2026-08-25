---
type: process
status: verified — 2026-08-25, commit 3248c21
consumes: [Book]
produces: [Book.progress]
---

# play-mp3

Plays an MP3/M4B/M4A file via a native `<audio>` element — no TTS, no
provider chain, no chunking.

## Input → Movement → Output

`js/views/mp3-player.js` creates an object URL from `book.fileBlob`, sets it
as `<audio id="main-audio">`'s `src`, reads ID3 tags via `jsmediatags` for
chapter/title display, and drives play/pause/±15s-skip/sleep-timer directly
against the audio element's native API — writing `Book.progress.seconds`
periodically.

## Why this shape

This is deliberately the simplest path in the app: real audio files have a
real seekable timeline, so there's no need for the chunking/provider-chain
machinery `listen-epub` requires for synthesized speech. Keeping it a
separate file (rather than a `TTSProvider`-shaped abstraction over
`<audio>`) avoids forcing an artificial common interface onto two
fundamentally different playback models.

## Steps

1. `createManagedObjectUrl(book.fileBlob)` sets `<audio>`'s `src`.
   `js/views/mp3-player.js:73-74`
2. `jsmediatags.read()` overrides the displayed title from ID3 tags if
   present. `:80-89`
3. Play/pause/skip ±15s operate directly on `player.currentTime`/`.play()`/
   `.pause()`. `:104-129`
4. `timeupdate` listener throttles `saveProgress()` (writes
   `Book.progress.seconds`) every ~2s. `:191-204`

## If you change this

- **Hits:** `js/services/media-session.js` (lock-screen controls read from
  this player's real `currentTime`/`duration`), `PlaybackManager`
  (`setActive`/`setPlaying`/`setPaused`).
- **Does not hit:** anything in `js/tts/` — this process never imports from
  that directory.

## Surfaces

| Surface | Role |
|---|---|
| `js/views/mp3-player.js` | runs the whole process |
| `js/services/media-session.js` | reads position/duration for lock screen |

## See

- Objects: [../objects/book.md](../objects/book.md),
  [../objects/playback-manager.md](../objects/playback-manager.md)
- Source: `js/views/mp3-player.js`
