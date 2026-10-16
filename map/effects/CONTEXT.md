# Effects — if you're changing X, open these cards

A catalog, not a copy of every card's own Hits/Does-not-hit section. If this
index and a card disagree, the card is right — fix this file, not your
assumption.

| Changing... | Open these first | Because |
|---|---|---|
| `TTSSettings` shape | [objects/tts-settings.md](../objects/tts-settings.md), [processes/configure-voice.md](../processes/configure-voice.md), `js/tts/tts-router.js` | Settings screen and TTSRouter both assume this shape; update both together |
| `Book` fields | [objects/book.md](../objects/book.md) | Library grid, both player views, and import-service all read/write this shape directly (no ORM layer to catch a drift); an mp3 book's `tracks`/`bookmarks`/`series` didn't always exist — `normalizeBook()` upgrades old records in memory on every read, so a new field needs a default there too |
| `js/engines/audio-engine.js`'s chapter models (`hasTrackChapters`/`hasFileChapters`) | [processes/play-audio.md](../processes/play-audio.md) | Two unrelated "chapter" models are flattened into one `chapters` list in the player store and one chapters sheet — a multi-track book's tracks *are* its chapters (jump = reload `src`), an M4B's `AudioTrack.chapters` are markers inside one track (jump = seek only); a book is never both, but code touching one path can silently assume the other's jump mechanics |
| M4B chapter reading (`readM4bChapters`, `music-metadata`) | [processes/import-books.md](../processes/import-books.md) | Best-effort only — most real M4B files use the Nero `chpl` atom, which `music-metadata` cannot read, so this returns `[]` far more often than it finds chapters; never treat an empty result as an error |
| Chunking (`js/epub/text-extract.js`) | [processes/listen-epub.md](../processes/listen-epub.md), [objects/epub-progress.md](../objects/epub-progress.md) | Chunk size/boundaries are the unit for resuming and the skip-by-segment buttons; saved chunk positions stop matching if it changes |
| `PlayerState` / `PlayerEngine` (`js/services/player-store.js`) | [objects/player-store.md](../objects/player-store.md), [processes/play-audio.md](../processes/play-audio.md), [processes/listen-epub.md](../processes/listen-epub.md) | Both engines, Now playing, chapters sheet, mini player, bookmarks and `media-session-bridge.js` read this one shape; `status` must only come from engine emits. Settings' voice preview uses its **own** `TTSRouter`, not `sharedTtsRouter` — don't route preview through the store |
| `library-db.js` (DB version, `files` store, key helpers) | [objects/book-files.md](../objects/book-files.md), [objects/book.md](../objects/book.md) | Blobs live only in `files`; records are rewritten often and must stay Blob-free (Safari invalidates Blobs from rewritten records); a schema change needs an `upgrade` step |
| `Book.shelves` / `js/storage/shelves.js` | [objects/shelves.md](../objects/shelves.md) | Registry is in localStorage, membership on the book — change both sides together |
| `vite.config.js` (workbox config) | [processes/deploy.md](../processes/deploy.md) | Sets the base path `/Audiobook-player/` and what the service worker precaches |
| Anything spanning more than one of the files above | [processes/deploy.md](../processes/deploy.md) | Every push to `master` goes live with no staging step — stage multi-file changes on a separate branch first |

## Does not need touching, ever, for a TTS/voice change

`js/engines/audio-engine.js`, `js/services/media-session-bridge.js` — audio
playback has no dependency on anything in `js/tts/`.
