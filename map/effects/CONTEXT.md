# Effects — if you're changing X, open these cards

A catalog, not a copy of every card's own Hits/Does-not-hit section. If this
index and a card disagree, the card is right — fix this file, not your
assumption.

| Changing... | Open these first | Because |
|---|---|---|
| Any `TTSProvider` file (`js/tts/*-tts.js`) | [objects/tts-provider.md](../objects/tts-provider.md), [processes/listen-epub.md](../processes/listen-epub.md) | Must throw `TTSQuotaExceededError` specifically for quota, or the fallback chain won't advance — any other thrown error drops the whole chain to Web Speech |
| `TTSSettings` shape | [objects/tts-settings.md](../objects/tts-settings.md), [processes/configure-voice.md](../processes/configure-voice.md), `js/tts/tts-router.js` `configure()` | Settings screen and TTSRouter both assume this exact shape; a shape change needs both updated together, on a feature branch (see [processes/deploy.md](../processes/deploy.md)) |
| `Book` fields | [objects/book.md](../objects/book.md) | Library grid, both player views, and import-service all read/write this shape directly (no ORM layer to catch a drift) |
| Chunking (`js/epub/text-extract.js`) | [processes/listen-epub.md](../processes/listen-epub.md), [objects/chunk-cache.md](../objects/chunk-cache.md), [objects/epub-progress.md](../objects/epub-progress.md) | Chunk size/boundaries are the atomic unit for caching, resuming, and the skip-by-segment UI buttons — changing it invalidates existing cache keys |
| `PlaybackManager` | [objects/playback-manager.md](../objects/playback-manager.md) | Settings' voice-preview flow deliberately uses its **own** separate `TTSRouter`, not this singleton — don't route preview playback through here |
| `vite.config.js` (worker/workbox config) | [processes/deploy.md](../processes/deploy.md) | The Kokoro provider's build depends on `worker.format: 'es'` and `workbox.globIgnores` excluding its ~2MB worker chunk — removing either silently breaks the production build or bloats every PWA install |
| Anything spanning more than one of the files above | [processes/deploy.md](../processes/deploy.md) | Every push to `master` goes live with no staging step — stage multi-file changes on a separate branch first |

## Does not need touching, ever, for a TTS/voice change

`js/views/mp3-player.js`, `js/services/media-session.js`'s MP3 wiring — MP3
playback has no dependency on anything in `js/tts/`.
