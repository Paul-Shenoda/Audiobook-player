---
type: process
status: verified — 2026-08-25, commit 3248c21
consumes: [File[]]
produces: [Book]
---

# import-books

User picks one or more files from the OS file picker; each becomes a `Book`
record in IndexedDB, skipping exact re-imports.

## Input → Movement → Output

A `File[]` from `<input type="file" multiple>` (`js/views/library.js`) goes
into `importBooks(files, onProgress)`; each file is deduped against existing
books by filename+size, classified as mp3 or epub, cover art extracted where
available, and written as a new `Book` via `addBook()`.

## Why this shape

Dedup by filename+size (not content hash) is deliberate — re-selecting the
same folder of files (common on iOS Safari, which re-shows the whole Files
picker rather than remembering a prior selection) must be a safe no-op, not
a full-content hash over potentially hundreds of MB per file.

## Steps

1. `isDuplicate(existing, file)` checks filename+size against already-stored
   books. `js/services/import-service.js:25`
2. `isAudioFile(file)` classifies mp3/m4b/m4a vs. epub by extension/MIME.
   `js/services/import-service.js:63`
3. `importSingleFile(file, existing)` extracts ID3 cover art
   (`pictureToBlob`, `:72`) for audio files, builds the `Book` shape.
   `js/services/import-service.js:38`
4. `importBooks(files, onProgress)` loops all files, calling `addBook()`
   (`js/storage/library-db.js:67`) per new book, reporting progress back to
   the library view's import-status banner. `js/services/import-service.js:85`

## If you change this

- **Hits:** `js/views/library.js` (the only caller, renders the progress
  banner and refreshes the grid after), `js/storage/library-db.js`
  (`addBook`).
- **Does not hit:** `TTSSettings`/provider registry, `PlaybackManager` — a
  freshly-imported book is not opened or played automatically.

## Surfaces

| Surface | Role |
|---|---|
| `js/views/library.js` | triggers, shows progress |
| `js/services/import-service.js` | runs the process |

## See

- Objects: [../objects/book.md](../objects/book.md)
- Source: `js/services/import-service.js`
