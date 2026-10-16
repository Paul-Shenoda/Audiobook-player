---
type: process
status: updated — 2026-10-16 (AI narration removed)
consumes: [TTSSettings]
produces: [TTSSettings]
---

# configure-voice

The user picks a default read-aloud speed and a built-in voice in Settings.

## Steps

1. `js/views/settings.js` loads `TTSSettings` and lists the device's voices
   through `TTSRouter.listVoices()` (the list can arrive late, so it listens
   for `voiceschanged`).
2. Preview speaks a sample sentence with a separate `TTSRouter`, so it never
   disturbs the shared narrator.
3. Save writes `{ rate, webSpeechVoiceId }` with `saveTTSSettings()`.

## If you change this

- **Hits:** `js/tts/tts-router.js`. Settings also shows storage usage and
  reopens the welcome screen.
- **Does not hit:** `Book` or the library.

## See

- Objects: [../objects/tts-settings.md](../objects/tts-settings.md)
- Source: `js/views/settings.js`
