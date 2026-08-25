# How to walk this map

Open [objects/_index.md](objects/_index.md) for the noun list, or a
[processes/](processes/) card for a movement, before reading any source file
directly. Each card's citations tell you exactly where to look next — don't
re-read the whole tree "just in case."

## Universes

- **live** — everything in this map is live (in force, cite/implement
  against it). This is a small, actively-maintained codebase with no
  parallel legacy path.
- **leftover** — none. The one place an old shape used to linger — the
  pre-chain `TTSSettings` format (`providerId`/`apiKey`/`proxyUrl` directly,
  no chain) — is fully migrated away by `migrateSettings()` on first load;
  see [objects/tts-settings.md](objects/tts-settings.md). It's read-once
  compatibility code, not a second live format.
- **ghost** — none. Nothing here is named/stubbed without being wired.

## Name collisions / product vs. code language

- **"Listen"** (the button, the mode) = EPUB text-to-speech playback, driven
  by `TTSRouter` in `js/tts/tts-router.js`. Completely separate code path
  from MP3 playback (`js/views/mp3-player.js`), which is a native `<audio>`
  element and never touches `js/tts/` at all.
- **"Provider"** always means a `TTSProvider` (the pluggable narrator
  contract, `js/tts/provider-interface.js`) — never a cloud/hosting
  provider, never GitHub.
- **"Chain"** means `TTSSettings.providerChain` — the user's ordered
  fallback list of enabled BYOK narrators (fixed relative priority:
  ElevenLabs → OpenAI → Google, Web Speech always the implicit final
  fallback). Not a blockchain, not related to `chunk-cache.js`'s cache keys.
- **"Chunk"** means a ~2000-character text segment (`js/epub/text-extract.js`
  `chunkText`) — the atomic unit of both TTS synthesis and the "skip
  back/forward" buttons on the Listen screen. Not a network/HTTP chunk.
- **Two progress records exist for the same book, on purpose**: `Book.progress`
  (coarse, IndexedDB, survives across devices/reinstalls conceptually) vs.
  `EpubProgress` (fine-grained chunk position, localStorage only). See
  [objects/book.md](objects/book.md) and
  [objects/epub-progress.md](objects/epub-progress.md) — they are not
  duplicates of the same fact, they answer different questions ("where did
  the user leave off, roughly" vs. "which exact chunk is mid-sentence").
