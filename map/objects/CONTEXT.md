# Objects — the nouns

One card per durable type or piece of cross-view state. Not every exported
function gets a card — a pure utility (`format-time.js`, `book-filters.js`)
is cited from whichever object or process card uses it, not given its own
card. A noun earns a card when other code holds a reference to it, persists
it, or has to reason about its shape.

Six cards, clustered by how a developer would ask about them:

- **library** — [book.md](book.md)
- **tts** — [tts-provider.md](tts-provider.md), [tts-settings.md](tts-settings.md),
  [chunk-cache.md](chunk-cache.md), [epub-progress.md](epub-progress.md)
- **playback** — [playback-manager.md](playback-manager.md)

Start at [_index.md](_index.md) for the one-line-each list.
