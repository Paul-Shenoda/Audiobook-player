---
type: object
cluster: library
universe: live
status: verified — 2026-08-25, commit 3248c21
entity: js/storage/library-db.js
---

# Book

The library record — one MP3/M4B/M4A or EPUB file plus its metadata and
playback progress. Product name "book" matches the code name exactly.

## Why this shape

A single record type covers both audio and EPUB books so the library grid,
search, and sort code never branches by format. `type` is the only fork
point, and it's checked at the routing layer (`js/main.js` `openBook()`),
not scattered through the library view.

## Shape

- `id`, `type` (`'mp3'|'epub'`), `title`, `author`, `fileBlob`, `coverBlob`
- `sourceFileName` / `sourceFileSize` — the dedup key re-import checks against
- `addedAt`, `lastOpenedAt`, `finishedAt`
- `progress: BookProgress` — shape differs by type: `seconds` for mp3,
  `chapterIndex`/`chunkIndex`/`percent` for epub

Citations: `js/storage/library-db.js:7-27` (typedefs), `:48-104` (CRUD)

## Connected to

- **owns:** `BookProgress` (inline field, not a separate table)
- **owned-by:** nothing — root record, IndexedDB via `idb`
- **joins:** `ChunkCache` via `bookId` (audio cache is keyed per book)
- **looks-like-but-is-not:** `EpubProgress` (`js/tts/playback-state.js`) — a
  separate, more granular, localStorage-only record of mid-chapter chunk
  position. `Book.progress` is the coarse summary written back after each
  chunk starts; `EpubProgress` is what the reading engine actually resumes
  from. Two homes for two different questions — see
  [../CONTEXT.md](../CONTEXT.md).

## If you change this

- **Hits:** `js/views/library.js` (grid rendering, filters, delete-flow calls
  `clearBookCache(id)` at line 146 *before* `deleteBook(id)` at 148 — deleting
  a book does hit the TTS chunk cache), `js/services/import-service.js`
  (construction), `js/views/mp3-player.js` / `js/views/epub-listen.js`
  (progress writes via `updateBook`), `js/utils/cover-art.js`.
- **Does not hit:** `TTSSettings`/the provider registry — voice/narrator
  configuration is entirely independent of which book is open.

## Surfaces

| Surface | Role |
|---|---|
| `js/views/library.js` | reads (grid/search/sort), writes (delete) |
| `js/views/mp3-player.js` | writes `progress.seconds` |
| `js/views/epub-listen.js` | writes `progress.{chapterIndex,chunkIndex,percent}` |
| `js/services/import-service.js` | creates |

## See

- Source: `js/storage/library-db.js`
