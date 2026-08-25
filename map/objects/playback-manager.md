---
type: object
cluster: playback
universe: live
status: verified — 2026-08-25, commit 3248c21
entity: js/services/playback-manager.js
---

# PlaybackManager

The single cross-view "what's playing right now" singleton — a plain object
(not a class), constructed once at module load, imported by every view that
needs to know or change playback state. Product name: the mini bar at the
bottom of the screen reads from this.

## Why this shape

The library grid, the full player view, and the mini-player bar are three
separate DOM renders that all need to agree on one playback state without a
framework's shared-store machinery. A single exported object literal
(`export const playbackManager = {...}`) gives every importer the same
reference for free — no context/store/provider wiring needed in a
vanilla-JS app.

## Shape

- `book`, `type` (`'mp3'|'epub'`), `audio` (`HTMLAudioElement`, mp3 path
  only), `tts` (**the one app-wide `TTSRouter` instance** — constructed once
  at module load, not per-view), `isPlaying`, `isPaused`, `onStateChange`
  callback
- `setActive(book, type)`, `setPlaying`, `setPaused`, `clear()`, `notify()`

Citations: `js/services/playback-manager.js:10-64`

## Connected to

- **owns:** the singleton `TTSRouter` instance (`.tts`) — every EPUB
  listen session reuses this one router rather than constructing a new one
- **owned-by:** nothing — imported directly wherever needed
- **joins:** `Book` (via `.book`), `TTSProvider`/`TTSSettings` (transitively,
  through `.tts`)
- **looks-like-but-is-not:** a second `TTSRouter` — `js/views/settings.js`'s
  voice-preview flow constructs its **own separate** `new TTSRouter()`
  instance for previewing a voice, specifically so testing a voice in
  Settings can't collide with or interrupt an actual book playing elsewhere.

## If you change this

- **Hits:** `js/main.js` (constructs the mini-player, wires
  `onStateChange`), `js/views/mini-player.js`, `js/views/mp3-player.js` and
  `js/views/epub-listen.js` (both call `setActive`/`setPlaying`/`setPaused`
  on every state transition).
- **Does not hit:** `js/views/settings.js` (uses its own separate
  `TTSRouter`, not this singleton — see above).

## Surfaces

| Surface | Role |
|---|---|
| `js/main.js` | reads (renders mini-player on every change) |
| `js/views/mp3-player.js` | writes |
| `js/views/epub-listen.js` | writes |
| `js/views/mini-player.js` | reads |

## See

- Source: `js/services/playback-manager.js`
