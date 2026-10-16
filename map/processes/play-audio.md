---
type: process
status: updated — 2026-10-16 (player-store + engines restructure)
consumes: [Book, PlayerStore]
produces: [Book.progress, Book.bookmarks, Book.finishedAt]
---

# play-audio

Plays an mp3-type `Book`'s track(s) (mp3/m4b/m4a/mp4) through one native
`<audio>` element, driven by the audio engine — no TTS, no chunking. (EPUB
playback is [listen-epub](listen-epub.md); both show on the same Now playing
screen.)

## Input → Movement → Output

`renderNowPlaying()` (`js/views/now-playing.js:68`) calls `store.open(book)`
(`:147`); the store builds `createAudioEngine()` for `kind: 'audio'`. The
engine reads each file fresh from the `files` store
([../objects/book-files.md](../objects/book-files.md)), attaches an object URL
to its `<audio>`, and `emit`s state; views and the media session re-render
from `playerStore`. The engine writes `Book.progress.{trackIndex,seconds,percent}`
and `finishedAt`; bookmarks are written by `js/services/bookmarks.js`.

## Why this shape

Real audio has a real seekable timeline, so none of the chunking in
`listen-epub` is needed. Engines are separate from the store so views never
touch `<audio>`; `status` comes only from the element's events (`playing`,
`pause`, `error`), so a refused `play()` can't look like playback.

Two "chapter" models are flattened into the store's `chapters` list:

- **Track chapters** (`tracks.length > 1`) — each chapter is its own file;
  `goToChapter` reloads the source via `loadTrack`.
- **In-file chapters** (`tracks.length === 1 && tracks[0].chapters`, M4B
  markers from `readM4bChapters`, see [import-books](import-books.md)) —
  `goToChapter` just seeks; the source never changes. Decided once in `load()`;
  a book is never both.

## Steps

1. `load()` picks chapter model, creates the progress saver, wires `<audio>`
   events, resumes at the saved track minus a 10 s rewind.
   `js/engines/audio-engine.js:263-325`
2. `loadTrack()` reads the Blob fresh, drops stale loads via `loadToken`,
   re-applies speed after the source changes. `:157-187`
3. `publish()` maps element time to chapter-relative
   `chapterElapsed`/`chapterDuration`, plus `trackIndex/trackSeconds/trackDuration`.
   `:99-145`
4. `play()` rewinds 15 s after a pause over 5 min; `skip()` crosses file
   boundaries; `goToChapter`/`seekInChapter` per model. `:327-404`
5. `saveProgress()` via `createProgressSaver` (throttled ~5 s, flushed on
   pause, seek, hidden, pagehide); nothing saved until the book has played.
   `:197-205`, `js/services/progress-saver.js:1-30`
6. `onEnded()` rolls to the next track, or finishes (`finishedAt`); the sleep
   timer (`js/services/sleep-timer.js`) stops at timer expiry or end of chapter.
   `:227-254`
7. Chapters and bookmarks UI: `openChaptersSheet()` (two tabs), with
   `addBookmark`/`removeBookmark`/`jumpToBookmark` in
   `js/services/bookmarks.js:264-349`. `js/views/chapters-sheet.js:22-203`
8. Lock screen: `bridgeMediaSession(store)` maps hardware actions to store
   commands and mirrors metadata/position. `js/services/media-session-bridge.js:15-93`

## If you change this

- **Hits:** `js/services/player-store.js` (`PlayerEngine` contract and state
  fields), `js/views/now-playing.js`, `js/views/chapters-sheet.js`,
  `js/views/mini-player.js`, `js/services/media-session-bridge.js`,
  `js/services/bookmarks.js` (reads `trackIndex`/`trackSeconds`/`chapters`).
- **Does not hit:** anything in `js/tts/` or `js/engines/tts-engine.js`.

## Surfaces

| Surface | Role |
|---|---|
| `js/engines/audio-engine.js` | runs the process |
| `js/views/now-playing.js`, `js/views/chapters-sheet.js`, `js/views/mini-player.js` | render state, send commands |
| `js/services/media-session-bridge.js` | lock-screen controls |

## See

- Objects: [../objects/book.md](../objects/book.md),
  [../objects/player-store.md](../objects/player-store.md),
  [../objects/book-files.md](../objects/book-files.md)
- Processes: [import-books.md](import-books.md), [combine-audiobook.md](combine-audiobook.md),
  [listen-epub.md](listen-epub.md)
- Source: `js/engines/audio-engine.js`
