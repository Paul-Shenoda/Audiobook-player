# How to walk this map

Open [objects/_index.md](objects/_index.md) for the noun list, or a
[processes/](processes/) card for a movement, before reading any source file
directly. Each card's citations tell you exactly where to look next — don't
re-read the whole tree "just in case."

## Universes

- **live** — everything in this map is live (in force, cite/implement
  against it). This is a small, actively-maintained codebase with no
  parallel legacy path.
- **leftover** — none. `loadTTSSettings()` ignores any fields saved by older
  versions (other voice providers, API keys), so there is no second format.
- **ghost** — none. Nothing here is named/stubbed without being wired.

## Name collisions / product vs. code language

- **"Listen"** (the button, the mode) = EPUB text-to-speech playback, driven
  by the one `TTSRouter` narrator in `js/tts/tts-router.js` (Web Speech device
  voice only, experimental), run by `js/engines/tts-engine.js`. A separate
  engine from audio playback (`js/engines/audio-engine.js`), which is a native
  `<audio>` element and never touches `js/tts/`. Both engines feed the one
  `playerStore` and the one Now playing screen (`js/views/now-playing.js`).
- **"Chunk"** means a ~2000-character text segment (`js/epub/text-extract.js`
  `chunkText`) — the atomic unit of both speech and the "skip
  back/forward" buttons on the Listen screen. Not a network/HTTP chunk.
- **Two progress records exist for the same book, on purpose**: `Book.progress`
  (coarse, IndexedDB, survives across devices/reinstalls conceptually) vs.
  `EpubProgress` (fine-grained chunk position, localStorage only). See
  [objects/book.md](objects/book.md) and
  [objects/epub-progress.md](objects/epub-progress.md) — they are not
  duplicates of the same fact, they answer different questions ("where did
  the user leave off, roughly" vs. "which exact chunk is mid-sentence").
