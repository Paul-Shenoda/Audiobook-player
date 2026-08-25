---
type: object
cluster: tts
universe: live
status: verified — 2026-08-25, commit 3248c21
entity: js/tts/chunk-cache.js
---

# ChunkCache

IndexedDB cache of synthesized TTS audio `Blob`s, one entry per
`(book, chapter, chunk, voice, provider)` tuple, so re-listening or resuming
never re-pays a paid narrator for the same text.

## Why this shape

The cache key folds in `providerId` (see `cacheKey`'s signature) specifically
so switching narrators mid-book can't serve stale audio from a *different*
voice under the same book/chapter/chunk coordinates.

## Shape

- `cacheKey(bookId, chapterIndex, chunkIndex, voiceId, providerId) → string`
- `getCachedAudio(key)` / `setCachedAudio(key, blob, bookId)` → `Blob`
- `getCacheStats()` — per-book byte totals, surfaced in Settings' "AI audio
  cache" section
- `clearAllCache()` / `clearBookCache(bookId)`

Citations: `js/tts/chunk-cache.js:27,35,46,55,70,78`

## Connected to

- **owns:** nothing — a flat IndexedDB key→Blob store
- **owned-by:** nothing
- **joins:** `Book` (via `bookId`), `TTSProvider` (via `providerId` embedded
  in the key)
- **looks-like-but-is-not:** `js/tts/usage-tracker.js`'s monthly
  character counter — that tracks BYOK quota-budget *estimates* (for
  providers like Google that never error on quota, just silently bill), a
  completely separate `localStorage` mechanism from this audio-blob cache.

## If you change this

- **Hits:** `js/tts/tts-router.js` `getChunkAudio()` (the only caller that
  reads/writes cache entries), `js/views/settings.js`'s cache section
  (list/clear buttons), `js/views/library.js:146` (deleting a book calls
  `clearBookCache(id)` *before* `deleteBook(id)` — deletion does hit this).
- **Does not hit:** `js/tts/usage-tracker.js` (separate budget-tracking
  mechanism, not read or written here).

## Surfaces

| Surface | Role |
|---|---|
| `js/tts/tts-router.js` | reads/writes per chunk |
| `js/views/settings.js` | reads stats, writes (clear) |
| `js/views/library.js` | writes (clear, on book delete) |

## See

- Source: `js/tts/chunk-cache.js`
