---
type: object
cluster: playback
universe: live
status: updated — 2026-10-16 (player-store + engines restructure)
entity: js/services/player-store.js
---

# PlayerStore

The single cross-view "what's playing right now" state — one app-wide
`playerStore`, created by `createPlayerStore()` and imported by every view
that shows or controls playback. Product name: the Now playing screen, the
mini player bar and the lock-screen controls all read from this.

## Why this shape

The Now playing screen, the chapters sheet, the mini player and the media
session are separate renders that must agree on one playback state. The store
holds that state and sends commands, but never touches `<audio>`,
`speechSynthesis` or `TTSRouter` itself: an *engine* does, and reports what is
really happening back through `emit`. So `status` is only ever set by an
engine emit, never by a command — a rejected `play()` cannot look like
playback. Emits from a replaced engine are ignored.

## Shape

- `PlayerState`: `book`, `kind` (`'audio'|'epub'|null`), `status`
  (`idle|loading|playing|paused|error`), `error`, `rate`, `chapters`,
  `chapterIndex`, `chapterElapsed`, `chapterDuration`, `bookPercent`,
  `readAlong` (EPUB only: `{chunks, chunkIndex}`), `sleep`. The audio engine
  also emits `trackIndex`, `trackSeconds`, `trackDuration` (not in the typedef).
- `PlayerEngine` contract: `load(book, emit)`, `play`, `pause`, `setRate`,
  `skip`, `setSleep`, `goToChapter`, `seekInChapter(fraction)`, `destroy`.
- Store API: `getState`, `subscribe`, `setEngineFactory`, `open(book)`,
  `play/pause/toggle`, `setRate`, `skip`, `next/prevChapter`, `goToChapter`,
  `seekInChapter`, `setSleep`, `stop` (pause, keep loaded), `close` (reset to idle).
- `open(book)` is a no-op for the already-loaded book unless it errored;
  otherwise it destroys the old engine and builds one for
  `book.type === 'mp3' ? 'audio' : 'epub'`.

Citations: `js/services/player-store.js:5-36` (typedefs), `:39-52` (`initialState`),
`:62-181` (`createPlayerStore`; `open` at `:105`), `:183` (`playerStore`). Engine factory is registered in
`js/main.js:42`.

## Connected to

- **owns:** the active engine: `createAudioEngine()`
  (`js/engines/audio-engine.js:35`, `<audio>`, resume/progress saving, sleep
  timer) or `createTtsEngine()` (`js/engines/tts-engine.js:53`, EPUB text via
  the `sharedTtsRouter` from `js/tts/tts-router.js:138`)
- **owned-by:** nothing — imported directly (`playerStore`); tests make their own
- **joins:** `Book` (via `state.book`), `TTSSettings` (transitively, through the
  TTS engine's router)
- **looks-like-but-is-not:** the Settings voice-preview `TTSRouter`
  (`js/views/settings.js:17`, `new TTSRouter()`), deliberately separate from
  `sharedTtsRouter` so previewing a voice cannot interrupt a book playing.

## If you change this

- **Hits:** `js/engines/audio-engine.js`, `js/engines/tts-engine.js` (must
  implement `PlayerEngine`), `js/views/now-playing.js`,
  `js/views/chapters-sheet.js`, `js/views/mini-player.js`,
  `js/services/media-session-bridge.js`, `js/services/bookmarks.js` (reads
  state, drives the store), `js/main.js` (factory, `playerStore.close()` via
  the view lifecycle in `js/services/view-lifecycle.js`).
- **Does not hit:** `js/views/settings.js` (own router), `js/storage/*`
  (engines write progress; the store never does).

## Surfaces

| Surface | Role |
|---|---|
| `js/engines/audio-engine.js`, `js/engines/tts-engine.js` | write (via `emit`) |
| `js/views/now-playing.js` | reads (`subscribe`), sends commands |
| `js/views/chapters-sheet.js` | reads, sends commands |
| `js/views/mini-player.js` | reads, sends play/skip |
| `js/services/media-session-bridge.js` | reads, sends commands |
| `js/main.js` | sets the engine factory, closes on cleanup |

## See

- Source: `js/services/player-store.js`
- Processes: [../processes/play-audio.md](../processes/play-audio.md),
  [../processes/listen-epub.md](../processes/listen-epub.md)
