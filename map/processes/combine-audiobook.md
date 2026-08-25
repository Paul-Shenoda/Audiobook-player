---
type: process
status: verified — 2026-08-25, commit 9cd694a
consumes: [File[]]
produces: [Book]
---

# combine-audiobook

User explicitly picks several chapter files and merges them into one
multi-track `Book`, instead of each file becoming its own book. This is a
deliberately separate action from [import-books](import-books.md), not a
prompt that appears when multiple files are selected there — selecting
several files through the normal "Add Books" picker always still produces
several separate books.

## Input → Movement → Output

A `File[]` from the library header's dedicated combine button/file input
(`js/views/library.js:53-54`) is natural-sorted (`naturalSortFiles`, so
"Chapter 2" comes before "Chapter 10"), shown in a preview sheet where the
user can reorder files and set a title/author override, then passed to
`importCombinedAudiobook(files, overrides)` on confirm — producing one
`Book` whose `tracks` array has one `AudioTrack` per file, in the
confirmed order.

## Why this shape

The user chose "always separate by default, opt-in combine" explicitly —
the ambiguity of "does selecting 3 files mean 3 books or 1?" is resolved by
never guessing: the default picker never combines, and combining requires
a second, distinct, deliberate action. The preview/reorder step exists
because natural sort is a good default but not guaranteed correct for
inconsistently-named chapter files (only two reorder controls — up/down —
not drag-and-drop, since drag-and-drop is unreliable on touch without a
dedicated library, and up/down buttons cover the same need).

## Steps

1. `#combine-btn` click opens `#combine-input`'s native file picker.
   `js/views/library.js:194-196`
2. On file selection, `naturalSortFiles()` sorts, then
   `openCombinePreviewModal()` renders the reorder/title/author sheet.
   `js/views/library.js:198-209`, `:341-` (modal)
3. Up/down buttons in the modal swap adjacent entries in the in-memory
   `order` array and re-render; no drag-and-drop.
4. On submit, `importCombinedAudiobook(order, { title, author })` reads
   tags per file (first file's tag/filename is the fallback title/author),
   builds one `AudioTrack` per file, and calls `addBook()`.
   `js/services/import-service.js:211-234`

## If you change this

- **Hits:** `js/views/library.js` (the only caller), `js/services/import-service.js`
  (`importCombinedAudiobook`, `naturalSortFiles`), `js/storage/library-db.js`
  (`addBook`) — the resulting `Book.tracks` shape is exactly what
  [play-mp3](play-mp3.md)'s track-chapter model expects.
- **Does not hit:** `isDuplicate`'s per-track dedup check in `importBooks` —
  combined files are not run back through the default import path, so a
  file already used in a combined book could be selected again there
  without being flagged (accepted tradeoff, not yet handled).

## Surfaces

| Surface | Role |
|---|---|
| `js/views/library.js` | triggers, renders reorder/preview modal |
| `js/services/import-service.js` | runs the process |

## See

- Objects: [../objects/book.md](../objects/book.md)
- Processes: [import-books.md](import-books.md), [play-mp3.md](play-mp3.md)
- Source: `js/services/import-service.js`, `js/views/library.js`
