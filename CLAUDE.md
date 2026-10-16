# Audiobook-player

Client-side PWA: play local MP3/M4B/M4A/MP4 audiobooks. Experimental extra:
read an EPUB aloud with the device's built-in voice (Web Speech only; no AI
narration). No backend — IndexedDB storage, static GitHub Pages
deployment. Full feature list and setup: [README.md](README.md).

## Where things live

| Area | Path | What |
|---|---|---|
| Views (screens) | `js/views/` | library, now-playing (one player for every book), chapters-sheet, settings, mini-player |
| Engines | `js/engines/` | audio-engine (`<audio>` for files), tts-engine (EPUB read-aloud) |
| EPUB narrator | `js/tts/` | tts-router (the one narrator: settings + events), web-speech (Web Speech wrapper), playback-state (EPUB progress and time estimates) |
| Library data | `js/storage/library-db.js` | the `Book` record, IndexedDB |
| Services | `js/services/` | import, player-store (the one playback state), media-session-bridge, bookmarks, sleep timer |
| Styles | `css/` | style.css (shared tokens), library.css, player.css |
| Deploy | `.github/workflows/deploy.yml` | push to `master` → build → GitHub Pages |

## Before changing anything

Read [map/CLAUDE.md](map/CLAUDE.md) — it answers *what is X* and *what else
moves if I change X* without re-reading the whole tree. Start there for any
non-trivial edit.

## Commands

`npm run dev` · `npm run build` · `npm run lint` · `npm run test` — see
[README.md](README.md#scripts) for details.
