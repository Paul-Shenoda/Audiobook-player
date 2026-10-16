# Objects — the nouns

One card per durable type or piece of cross-view state. Not every exported
function gets a card — a pure utility (`format-time.js`, `book-filters.js`)
is cited from whichever object or process card uses it, not given its own
card. A noun earns a card when other code holds a reference to it, persists
it, or has to reason about its shape.

Six cards, clustered by how a developer would ask about them:

- **library** — [book.md](book.md), [book-files.md](book-files.md),
  [shelves.md](shelves.md)
- **tts** — [tts-settings.md](tts-settings.md),
  [epub-progress.md](epub-progress.md)
- **playback** — [player-store.md](player-store.md)

Start at [_index.md](_index.md) for the one-line-each list.
