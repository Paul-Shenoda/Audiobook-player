---
type: object
cluster: library
universe: live
status: updated — 2026-10-16
entity: js/storage/shelves.js
---

# Shelf

A named tag for grouping books. A book can sit on several shelves; deleting a
shelf never deletes books.

## Why this shape

Shelves are tags, not folders. The registry (`{id, name, createdAt}`) is a
small list in `localStorage['shelves']`; membership lives on the book as
`Book.shelves: string[]` of shelf ids (defaulted to `[]` by `normalizeBook`).
That keeps the Blob-free book record the only place membership is stored and
lets one book belong to many shelves without a join table.

## Shape

- `listShelves`, `createShelf`, `renameShelf` (names trimmed, unique
  case-insensitively, else throws); `deleteShelf` removes the id from every
  book via `updateBook`; `setBookShelves(bookId, ids)` drops unknown ids;
  `shelfSummaries(shelves, books)` is pure.
- If `localStorage` throws, an in-memory fallback keeps the session working.

Citations: `js/storage/shelves.js:14-38` (storage), `:55-107` (API),
`:115-120` (summaries); `js/storage/library-db.js:101-102,121`.

## Connected to

- **owns:** the `shelves` localStorage registry
- **owned-by:** `localStorage['shelves']` (registry) plus `Book.shelves` (membership)
- **joins:** [Book](book.md) via shelf id
- **looks-like-but-is-not:** a folder — no nesting, no single-parent rule

## If you change this

- **Hits:** `js/views/library.js` (sidebar, Shelves tab, filtering via
  `filterByShelf`), `js/views/shelf-sheets.js` (assign / name sheets),
  `js/utils/book-filters.js`.
- **Does not hit:** playback (`js/engines/*`, `js/services/player-store.js`).

## Surfaces

| Surface | Role |
|---|---|
| `js/views/library.js` | reads, creates, renames, deletes |
| `js/views/shelf-sheets.js` | writes (`setBookShelves`, `createShelf`, `renameShelf`) |

## See

- Source: `js/storage/shelves.js`
- Objects: [book.md](book.md), [book-files.md](book-files.md)
