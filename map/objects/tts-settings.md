---
type: object
cluster: tts
universe: live
status: updated — 2026-10-16 (AI narration removed)
entity: js/tts/tts-router.js
---

# TTSSettings

The saved read-aloud settings: default speed and the chosen built-in voice.
Persisted as one `localStorage` key, `tts-settings`.

## Shape

```
{ rate: number, webSpeechVoiceId: string }
```

`loadTTSSettings()` keeps only these two fields and falls back to
`defaultSettings()` otherwise, so settings saved by older versions (provider
chains, API keys) are ignored. EPUB speed is saved per book on the `Book`
(`playbackRate`), not here; `rate` is only the default for books with none.

Citations: `js/tts/tts-router.js` (`defaultSettings`, `loadTTSSettings`,
`saveTTSSettings`)

## Connected to

- **owned-by:** `localStorage['tts-settings']`
- **joins:** `TTSRouter.configure()` takes this object; `WebSpeechTTS`
  gets the voice and rate from it.

## If you change this

- **Hits:** `js/views/settings.js` (form reads/writes it),
  `js/tts/tts-router.js`, `js/engines/tts-engine.js` (`loadSettings`).
- **Tests:** `tests/tts-router.test.js`.

## Surfaces

| Surface | Role |
|---|---|
| `js/views/settings.js` | reads, writes (Save Settings) |
| `js/engines/tts-engine.js` | reads on load |

## See

- Source: `js/tts/tts-router.js`
