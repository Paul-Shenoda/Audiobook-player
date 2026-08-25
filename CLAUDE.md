# Audiobook-player

Client-side PWA: play local MP3/M4B/M4A audiobooks and listen to EPUBs via
text-to-speech. No backend — IndexedDB storage, static GitHub Pages
deployment. Full feature list and setup: [README.md](README.md).

## Where things live

| Area | Path | What |
|---|---|---|
| Views (screens) | `js/views/` | library, mp3-player, epub-listen, settings, mini-player |
| TTS providers | `js/tts/` | pluggable narrator registry — web-speech, openai, elevenlabs, google, kokoro |
| Library data | `js/storage/library-db.js` | the `Book` record, IndexedDB |
| Services | `js/services/` | import, playback-manager (cross-view "what's playing" state), media session, sleep timer |
| Styles | `css/` | style.css (shared tokens), library.css, player.css |
| Deploy | `.github/workflows/deploy.yml` | push to `master` → build → GitHub Pages |

## Before changing anything

Read [map/CLAUDE.md](map/CLAUDE.md) — it answers *what is X* and *what else
moves if I change X* without re-reading the whole tree. Start there for any
non-trivial edit.

## Commands

`npm run dev` · `npm run build` · `npm run lint` · `npm run test` — see
[README.md](README.md#scripts) for details.
