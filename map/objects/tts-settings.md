---
type: object
cluster: tts
universe: live
status: verified — 2026-08-25, commit 3248c21
entity: js/tts/tts-router.js
---

# TTSSettings

The user's saved narrator configuration — global playback speed, an ordered
provider fallback chain, and per-provider credentials. Persisted as one
`localStorage` key, `tts-settings`.

## Why this shape

`providerChain` + `providerConfigs` (keyed by provider id) replaced an older
single-provider shape (`providerId`/`voiceId`/`apiKey`/`proxyUrl` flat on the
object) specifically so multiple BYOK providers can be configured at once
and tried in a fixed relative priority order — ElevenLabs → OpenAI → Google
— when one's free-tier quota runs out mid-book. `migrateSettings()` upgrades
any old-shape saved settings transparently on first load; nothing else in
the codebase ever sees the old shape.

## Shape

```
{ rate, providerChain: string[], providerConfigs: {[id]: object}, webSpeechVoiceId }
```

Citations: `js/tts/tts-router.js:8-14` (typedef), `:29-37`
(`defaultSettings`), `:48-64` (`migrateSettings`)

## Connected to

- **owns:** nothing — a plain settings blob
- **owned-by:** `localStorage['tts-settings']`
- **joins:** the `TTSProvider` catalog — a `providerChain` entry that
  doesn't match a registered provider id is silently filtered out by
  `configure()` rather than erroring (`tests/tts-router.test.js` covers
  this: "filters out unregistered provider ids without throwing")
- **looks-like-but-is-not:** the pre-migration flat shape
  (`providerId`/`apiKey`/`proxyUrl`). That shape doesn't exist as a live
  parallel format — it's read once, upgraded, and gone; see
  [../CONTEXT.md](../CONTEXT.md) universes.

## If you change this

- **Hits:** `js/views/settings.js` (the entire tiered form reads/writes this
  shape), `js/tts/tts-router.js` `configure()`/`speak()`/`playAIChunk()`
  (chain traversal and quota-fallback logic).
- **Does not hit:** `js/tts/chunk-cache.js` — it caches by explicit
  `(bookId, chapterIndex, chunkIndex, voiceId, providerId)` arguments passed
  in per-call, it never reads `TTSSettings` itself.

## Surfaces

| Surface | Role |
|---|---|
| `js/views/settings.js` | reads, writes (Save Settings) |
| `js/tts/tts-router.js` | reads, drives chain construction and playback |
| `js/views/epub-listen.js` | reads (`loadTTSSettings()` on open) |

## See

- Source: `js/tts/tts-router.js`
