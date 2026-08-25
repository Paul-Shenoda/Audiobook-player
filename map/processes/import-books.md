---
type: process
status: verified — 2026-08-25, commit 9cd694a
consumes: [File[]]
produces: [Book]
---

# import-books

User picks one or more files from the OS file picker; each becomes its own
`Book` record in IndexedDB, skipping exact re-imports. This is always the
default — one selected file, one book — even when several are selected at
once. Combining several chapter files into a single multi-track book is a
separate, explicitly opt-in action; see
[combine-audiobook.md](combine-audiobook.md).

## Input → Movement → Output

A `File[]` from `<input type="file" multiple>` (`js/views/library.js`) goes
into `importBooks(files, onProgress)`; each file is deduped against existing
books (per-track for mp3 books, flat fields for epub) by filename+size,
classified as mp3 or epub, cover art extracted where available, and written
as a new `Book` via `addBook()`. For M4B/M4A files, chapter markers are
also read best-effort and attached to the single track if present.

## Why this shape

Dedup by filename+size (not content hash) is deliberate — re-selecting the
same folder of files (common on iOS Safari, which re-shows the whole Files
picker rather than remembering a prior selection) must be a safe no-op, not
a full-content hash over potentially hundreds of MB per file. An mp3 book's
dedup check must walk every track, not just a book-level flat pair, since a
combined audiobook has one filename+size per chapter file.

M4B chapter extraction is deliberately best-effort, not a requirement: most
audiobook tools (ffmpeg, m4b-tool) write the Nero `chpl` atom, which
`music-metadata` — the only maintained browser-compatible chapter-reading
library available — cannot parse; it only reads QuickTime chapter *tracks*.
Failing to find chapters is not an error; the book still imports and plays
fine as a single track.

## Steps

1. `isDuplicate(existing, file)` checks filename+size against already-stored
   books, walking `b.tracks` per-track for mp3 books. `js/services/import-service.js:26-34`
2. `isAudioFile(file)` classifies mp3/m4b/m4a vs. epub by extension/MIME.
   `js/services/import-service.js:67`
3. `importSingleFile(file, existing)` extracts ID3 cover art
   (`pictureToBlob`, `:76`) for audio files, builds the `Book` shape.
   `js/services/import-service.js:42`
4. `readM4bChapters(file)` attempts in-file chapter markers for M4B/M4A
   files only, returning `[]` on any failure or fewer than 2 chapters
   found — never throws. `js/services/import-service.js:155-170`
5. `importBooks(files, onProgress)` loops all files, calling `addBook()`
   (`js/storage/library-db.js:160`) per new book, reporting progress back
   to the library view's import-status banner. `js/services/import-service.js:89`

## If you change this

- **Hits:** `js/views/library.js` (the only caller, renders the progress
  banner and refreshes the grid after), `js/storage/library-db.js`
  (`addBook`), `music-metadata` (chapter parsing dependency).
- **Does not hit:** `TTSSettings`/provider registry, `PlaybackManager` — a
  freshly-imported book is not opened or played automatically.

## Surfaces

| Surface | Role |
|---|---|
| `js/views/library.js` | triggers, shows progress |
| `js/services/import-service.js` | runs the process |

## See

- Objects: [../objects/book.md](../objects/book.md)
- Processes: [combine-audiobook.md](combine-audiobook.md)
- Source: `js/services/import-service.js`
