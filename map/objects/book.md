---
type: object
cluster: library
universe: live
status: verified — 2026-08-25, commit 9cd694a
entity: js/storage/library-db.js
---

# Book

The library record — one audiobook (single-file or chapter-per-file) or
EPUB, plus its metadata, playback progress, bookmarks, and series info.
Product name "book" matches the code name exactly.

## Why this shape

A single record type covers both audio and EPUB books so the library grid,
search, and sort code never branches by format. `type` is the only fork
point, and it's checked at the routing layer (`js/main.js` `openBook()`),
not scattered through the library view.

An mp3-type book's audio lives in `tracks: AudioTrack[]`, not a single
`fileBlob` — one entry for an ordinary single-file audiobook, one per
chapter for a book assembled via the opt-in "combine into one audiobook"
import action (see [../processes/combine-audiobook.md](../processes/combine-audiobook.md)).
Records written before this existed are upgraded to this shape in memory
on every read by `normalizeBook()` — never migrated destructively in
IndexedDB. `epub`-type books are untouched by any of this and still use
the original flat `fileBlob`/`sourceFileName`/`sourceFileSize` fields.

## Shape

- `id`, `type` (`'mp3'|'epub'`), `title`, `author`, `coverBlob`
- `tracks: AudioTrack[]` — mp3 only, always populated by `normalizeBook()`.
  Each track: `{ fileBlob, sourceFileName, sourceFileSize, label?, chapters? }`.
  `chapters?: FileChapter[]` (`{ title, startSeconds }`) is a single track's
  own best-effort in-file chapter markers (M4B QuickTime chapter tracks,
  read by `readM4bChapters()`) — only meaningful when a book has exactly
  one track; a multi-track book's tracks *are* its chapters.
- `fileBlob` — epub only going forward; kept on old mp3 records purely as
  what `normalizeBook()` migrates a single-file `tracks` entry from
- `sourceFileName`/`sourceFileSize` — epub only going forward (mp3 moved
  this per-track); the dedup key `isDuplicate()` checks, per-track for mp3
- `addedAt`, `lastOpenedAt`, `finishedAt`
- `series: SeriesInfo|null` — `{ name, position? }`, e.g. "Book 2" of a
  series; set via the library card's "Edit details" action
- `bookmarks: Bookmark[]` — manual named save points, distinct from the
  automatic resume position in `progress`. Exactly one of
  `trackIndex+seconds` (mp3) or `chapterIndex+chunkIndex` (epub) is set,
  matching the book's `type`
- `progress: BookProgress` — shape differs by type: `trackIndex`+`seconds`
  for mp3, `chapterIndex`/`chunkIndex`/`percent` for epub

Citations: `js/storage/library-db.js:7-71` (typedefs), `:83-106`
(`normalizeBook`), `:108-196` (CRUD)

## Connected to

- **owns:** `BookProgress`, `AudioTrack[]` (and each track's own
  `FileChapter[]`), `Bookmark[]`, `SeriesInfo` — all inline fields, not
  separate tables
- **owned-by:** nothing — root record, IndexedDB via `idb`
- **joins:** `ChunkCache` via `bookId` (audio cache is keyed per book)
- **looks-like-but-is-not:**
  - `EpubProgress` (`js/tts/playback-state.js`) — a separate, more
    granular, localStorage-only record of mid-chapter chunk position.
    `Book.progress` is the coarse summary written back after each chunk
    starts; `EpubProgress` is what the reading engine actually resumes
    from. Two homes for two different questions — see
    [../CONTEXT.md](../CONTEXT.md).
  - A `Bookmark` looks like `progress` but isn't the same fact: `progress`
    is the single automatic "where the app resumes from" pointer, silently
    overwritten continuously; `bookmarks` is a user-curated, named list of
    positions that never gets silently overwritten.
  - An `AudioTrack.chapters` entry (in-file M4B chapter marker) looks like
    a multi-track book's per-file chapter but isn't: jumping to one seeks
    within the same `player.src`, it never reloads it. The two are
    unified only at the UI layer (`js/views/mp3-player.js`'s chapter
    picker), never in storage.

## If you change this

- **Hits:** `js/views/library.js` (grid rendering, filters, delete-flow
  calls `clearBookCache(id)` *before* `deleteBook(id)` — deleting a book
  does hit the TTS chunk cache; also the "Edit details" and "combine into
  one audiobook" modals), `js/services/import-service.js` (construction,
  per-track dedup, chapter extraction), `js/views/mp3-player.js` /
  `js/views/epub-listen.js` (progress + bookmark writes via `updateBook`),
  `js/utils/cover-art.js`, `js/utils/series-label.js`.
- **Does not hit:** `TTSSettings`/the provider registry — voice/narrator
  configuration is entirely independent of which book is open.

## Surfaces

| Surface | Role |
|---|---|
| `js/views/library.js` | reads (grid/search/sort), writes (delete, edit details, combine) |
| `js/views/mp3-player.js` | writes `progress.{trackIndex,seconds}`, `bookmarks` |
| `js/views/epub-listen.js` | writes `progress.{chapterIndex,chunkIndex,percent}`, `bookmarks` |
| `js/services/import-service.js` | creates (`importAudio`, `importCombinedAudiobook`, `importEpub`) |

## See

- Source: `js/storage/library-db.js`
- Processes: [../processes/play-mp3.md](../processes/play-mp3.md),
  [../processes/import-books.md](../processes/import-books.md),
  [../processes/combine-audiobook.md](../processes/combine-audiobook.md)
