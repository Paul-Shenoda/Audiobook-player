---
type: object
cluster: library
universe: live
status: updated — 2026-10-16
entity: js/storage/library-db.js
---

# Files store

The `files` object store in the `audiobook-library` IndexedDB (DB version 2):
every audio, EPUB and cover Blob, kept apart from the `books` records.

## Why this shape

Safari invalidates a Blob read from IndexedDB when the record holding it is
rewritten, and `books` records are rewritten on every progress save, shelf
change and bookmark. So Blobs are written once at import and never touched;
`updateBook` writes only the `books` store and strips any `fileBlob` /
`coverBlob` passed in. Readers must fetch a Blob fresh right before use and not
hold it.

## Shape

- Out-of-line string keys: `bookFileKey` = `<id>:file` (EPUB),
  `coverKey` = `<id>:cover` (`Book.hasCover`), `trackFileKey` =
  `<id>:track:<n>` (stored on each `AudioTrack.fileKey`).
- Readers: `getBookFile`, `getCoverBlob`, `getTrackFile`.
- `addBook` puts the Blobs and the Blob-free record in one transaction;
  `deleteBook` removes the record and the key range `<id>:`..`<id>:￿`.
- Upgrade v1 to v2: `moveBlobsToFilesStore` moves legacy `fileBlob`/`coverBlob`
  (and per-track blobs) out of records inside the version-change transaction.

Citations: `js/storage/library-db.js:4-21` (names, keys), `:149-199`
(migration), `:209-239` (`getDb`), `:273-303` (`addBook`), `:336-342`
(`deleteBook`), `:359-389` (readers).

## Connected to

- **owns:** the Blobs; **owned-by:** `js/storage/library-db.js`
- **joins:** [Book](book.md) by key prefix `<bookId>:`
- **looks-like-but-is-not:** a field on `Book` — records carry only
  `hasCover` and `tracks[].fileKey`, never a Blob

## If you change this

- **Hits:** `js/engines/audio-engine.js` (`getTrackFile`),
  `js/engines/tts-engine.js` (`getBookFile`), `js/utils/cover-art.js`
  (`getCoverBlob`), `js/services/import-service.js` (passes Blobs to `addBook`).
- **Does not hit:** `js/storage/shelves.js`, progress saving.

## Surfaces

| Surface | Role |
|---|---|
| `js/engines/audio-engine.js`, `js/engines/tts-engine.js`, `js/utils/cover-art.js` | read |
| `js/services/import-service.js` | writes (via `addBook`) |
| `js/views/library.js` | deletes (via `deleteBook`) |

## See

- Source: `js/storage/library-db.js`
- Objects: [book.md](book.md)
