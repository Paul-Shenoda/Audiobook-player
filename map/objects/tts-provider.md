---
type: object
cluster: tts
universe: live
status: verified — 2026-08-25, commit 3248c21
entity: js/tts/provider-interface.js
---

# TTSProvider

The pluggable-narrator contract plus its self-registering catalog and
factory registry. Product name: "AI narrator" / "voice" in the UI.

## Why this shape

A registry (two `Map`s keyed by provider id) replaced a hardcoded
if/else in `TTSRouter.configure()` specifically so a new narrator
(ElevenLabs, Google, Kokoro) never requires editing `tts-router.js` — each
provider file calls `registerProviderMeta()` and
`registerTTSProviderFactory()` as a side effect of being imported.
`js/tts/openai-tts.js` is the reference implementation to copy.

## Shape

- `id`, `name`, `tier` (`'free'|'byok'`), `description`, `limitations`
  (required for any free-tier provider beyond Web Speech),
  `configFields` (`TTSConfigField[]` — drives Settings' dynamic inputs)
- `listVoices(): Promise<TTSVoice[]>`, `synthesize(text, voiceId, options):
  Promise<Blob>`, optional `estimateCost(chars)`

Citations: `js/tts/provider-interface.js:42` (`isTTSProvider`), `:73`
(`registerProviderMeta`), `:78` (`listProviderCatalog`), `:94`
(`registerTTSProviderFactory`), `:102` (`getProviderFactory`), `:115`
(`TTSQuotaExceededError`)

## Connected to

- **owns:** nothing — stateless contract
- **owned-by:** nothing
- **joins:** `TTSSettings.providerConfigs` (per-id config blob keyed by
  provider id, built into a live instance by `TTSRouter.configure()`)
- **looks-like-but-is-not:** the `web-speech` provider. It has a
  `registerProviderMeta` entry (`js/tts/web-speech.js`, for the Settings
  catalog) but **no factory** — `TTSRouter` constructs `new WebSpeechTTS()`
  directly in its constructor, because Web Speech's playback path (browser
  utterances, no audio `Blob`) is fundamentally different from every other
  provider and can't be squeezed into `synthesize()`.

## If you change this

- **Hits:** every `js/tts/*-tts.js` file (must keep matching this shape),
  `js/tts/tts-router.js` `configure()`/`getChunkAudio()`, `js/views/settings.js`
  (renders `configFields`/`tier`/`limitations` dynamically from
  `listProviderCatalog()`).
- **Does not hit:** `js/storage/library-db.js`, `js/views/mp3-player.js`
  (native `<audio>`, never imports anything from `js/tts/`).

## Surfaces

| Surface | Role |
|---|---|
| `js/views/settings.js` | reads catalog, writes chosen per-provider config |
| `js/tts/tts-router.js` | reads factories, constructs the provider chain |

## See

- Source: `js/tts/provider-interface.js`
