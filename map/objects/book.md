---
type: object
cluster: library
universe: live
status: updated — 2026-10-16 (files store, shelves)
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

A book record never carries a Blob. Audio, EPUB and cover files live in
the separate `files` store ([book-files.md](book-files.md)); the record holds
only references (`hasCover`, `tracks[].fileKey`). An mp3-type book's audio
lives in `tracks: AudioTrack[]` — one entry for an ordinary single-file audiobook, one per
chapter for a book assembled via the opt-in "combine into one audiobook"
import action (see [../processes/combine-audiobook.md](../processes/combine-audiobook.md)).
Records written before `tracks` existed are upgraded in memory on every read
by `normalizeBook()`; the one destructive step is the DB v1 to v2 upgrade that
moves Blobs into `files`. `epub`-type books keep the flat
`sourceFileName`/`sourceFileSize` fields and read their file with `getBookFile`.

## Shape

- `id`, `type` (`'mp3'|'epub'`), `title`, `author`, `hasCover`
- `tracks: AudioTrack[]` — mp3 only, always populated by `normalizeBook()`.
  Each track: `{ fileKey, sourceFileName, sourceFileSize, label?, chapters? }`.
  `chapters?: FileChapter[]` (`{ title, startSeconds }`) is a single track's
  own best-effort in-file chapter markers (M4B QuickTime chapter tracks,
  read by `readM4bChapters()`) — only meaningful when a book has exactly
  one track; a multi-track book's tracks *are* its chapters.
- `sourceFileName`/`sourceFileSize` — epub only (mp3 has them per-track);
  the dedup key `isDuplicate()` checks, per-track for mp3
- `addedAt`, `lastOpenedAt`, `finishedAt`
- `series: SeriesInfo|null` — `{ name, position? }`, e.g. "Book 2" of a
  series; set via the library card's "Edit details" action
- `shelves: string[]` — ids of the shelves the book is on, see
  [shelves.md](shelves.md)
- `playbackRate?` — per-book speed, read by both engines
- `bookmarks: Bookmark[]` — manual named save points, distinct from the
  automatic resume position in `progress`. Exactly one of
  `trackIndex+seconds` (mp3) or `chapterIndex+chunkIndex` (epub) is set,
  matching the book's `type`
- `progress: BookProgress` — shape differs by type: `trackIndex`+`seconds`
  for mp3, `chapterIndex`/`chunkIndex`/`percent` for epub

Citations: `js/storage/library-db.js:23-104` (typedefs), `:116-140`
(`normalizeBook`), `:244-342` (CRUD), `:344-350` (`getMostRecentBook`)

## Connected to

- **owns:** `BookProgress`, `AudioTrack[]` (and each track's own
  `FileChapter[]`), `Bookmark[]`, `SeriesInfo` — all inline fields, not
  separate tables
- **owned-by:** nothing — root record, IndexedDB via `idb`
- **joins:** the `files` store via `<bookId>:` keys
  ([book-files.md](book-files.md)); `Shelf` via `shelves` ids
- **looks-like-but-is-not:**
  - `EpubProgress` (`js/tts/playback-state.js`) — a separate, more
    granular, localStorage-only record of mid-chapter chunk position.
    `Book.progress` is the coarse summary written back alongside it
    (`persistProgress()` in `js/engines/tts-engine.js:176`); `EpubProgress` is what the reading engine actually resumes
    from. Two homes for two different questions — see
    [../CONTEXT.md](../CONTEXT.md).
  - A `Bookmark` looks like `progress` but isn't the same fact: `progress`
    is the single automatic "where the app resumes from" pointer, silently
    overwritten continuously; `bookmarks` is a user-curated, named list of
    positions that never gets silently overwritten.
  - An `AudioTrack.chapters` entry (in-file M4B chapter marker) looks like
    a multi-track book's per-file chapter but isn't: jumping to one seeks
    within the same `player.src`, it never reloads it. The two are
    unified only in the player store's `chapters` list
    (`js/engines/audio-engine.js:99-117`), never in storage.

## If you change this

- **Hits:** `js/views/library.js` (grid, filters, shelves, delete via
  `deleteBook(id)` which also clears the book's files; "Edit details" and
  "combine into one audiobook" modals), `js/services/import-service.js`
  (construction, per-track dedup, chapter extraction),
  `js/engines/audio-engine.js` / `js/engines/tts-engine.js` (progress writes
  via `updateBook`), `js/services/bookmarks.js` (bookmark writes),
  `js/storage/shelves.js`, `js/utils/cover-art.js`, `js/utils/series-label.js`.
- **Does not hit:** `TTSSettings` — voice/narrator
  configuration is entirely independent of which book is open.

## Surfaces

| Surface | Role |
|---|---|
| `js/views/library.js` | reads (grid/search/sort), writes (delete, edit details, combine) |
| `js/engines/audio-engine.js` | writes `progress.{trackIndex,seconds,percent}`, `finishedAt` |
| `js/engines/tts-engine.js` | writes `progress.{chapterIndex,chunkIndex,percent}` |
| `js/services/bookmarks.js` | writes `bookmarks` |
| `js/storage/shelves.js` | writes `shelves` |
| `js/services/import-service.js` | creates (`importAudio`, `importCombinedAudiobook`, `importEpub`) |

## See

- Source: `js/storage/library-db.js`
- Objects: [book-files.md](book-files.md), [shelves.md](shelves.md)
- Processes: [../processes/play-audio.md](../processes/play-audio.md),
  [../processes/import-books.md](../processes/import-books.md),
  [../processes/combine-audiobook.md](../processes/combine-audiobook.md)
