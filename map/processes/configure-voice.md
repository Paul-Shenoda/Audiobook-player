---
type: process
status: verified — 2026-08-25, commit 3248c21
consumes: [TTSProvider catalog]
produces: [TTSSettings]
---

# configure-voice

User edits which narrators are enabled, in what fixed priority, with what
credentials, from the tiered Voice Settings screen.

## Input → Movement → Output

`js/views/settings.js` renders one row per entry in `listProviderCatalog()`,
split into "Free & Offline" (`tier: 'free'`) and "Bring Your Own Key"
(`tier: 'byok'`) sections; toggling a BYOK provider's checkbox reveals its
`configFields` and adds/removes its id from `providerChain` in fixed
relative order (ElevenLabs, then OpenAI, then Google) regardless of click
order; Save writes the resulting `TTSSettings` to `localStorage`.

## Why this shape

The chain's priority order is fixed by design, not user-reorderable (a
deliberate scope decision) — the settings form enforces this on save rather
than trusting insertion order from whatever sequence the user happened to
click checkboxes in.

## Steps

1. `listProviderCatalog()` supplies the provider list to render — the form
   has no hardcoded provider names. `js/tts/provider-interface.js:78`
2. Each BYOK row's checkbox toggle shows/hides `configFields` inputs
   generated from `TTSConfigField[]`.
3. A free-tier provider that exposes `isModelDownloaded()`/`downloadModel()`
   (currently only Kokoro) gets a "Download offline voice" button with a
   progress bar instead of going straight to a voice picker.
4. Save rebuilds `providerChain` in the fixed priority order from whichever
   checkboxes are on, and writes the full `TTSSettings` via
   `saveTTSSettings()`.

## If you change this

- **Hits:** every registered `TTSProvider`'s `configFields`/`tier`/
  `limitations` (this form renders them, doesn't special-case them),
  `js/tts/usage-tracker.js` (surfaces "X characters used this month" when
  non-zero).
- **Does not hit:** `Book`/library — voice configuration is entirely
  independent of any specific book.

## Surfaces

| Surface | Role |
|---|---|
| `js/views/settings.js` | runs the whole process |

## See

- Objects: [../objects/tts-provider.md](../objects/tts-provider.md),
  [../objects/tts-settings.md](../objects/tts-settings.md)
- Source: `js/views/settings.js`
