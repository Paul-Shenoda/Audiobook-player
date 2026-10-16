# Audiobook Player

A personal audiobook player that runs in the browser. Add MP3, M4B, M4A or MP4 audiobook files (for example free downloads from [LibriVox](https://librivox.org)) and listen on your phone or computer. There are no accounts and no server: everything is stored in your browser.

## Features

- **Library with shelves** — a grid of covers, a "Continue listening" entry, search and sort, and shelves you create to group books.
- **One Now playing screen** — the same player for every book: play/pause, seek, 15-second skip, speed, and a progress bar for the whole book.
- **Chapters and bookmarks** — chapter list (from multi-file books or embedded chapter markers when the file has them) and bookmarks you add while listening.
- **Per-book speed** — each book remembers its own playback speed.
- **Sleep timer** — stop after a set time or at the end of the chapter.
- **Lock-screen controls** — title, cover and play/pause/skip on the lock screen and in notification controls (Media Session).
- **Offline PWA** — a service worker caches the app, so it opens and plays your library without a connection. It can be added to the home screen.
- **Your files stay on your device** — books, covers and progress live in IndexedDB. The app asks the browser to protect that storage from automatic cleanup.
- **Experimental: EPUB read-aloud** — the app can read an EPUB aloud with your device's built-in voice (Web Speech), with a read-along view. That voice stops when you lock your phone or leave the app, so it is an extra, not the main use.

## Tip: free audiobooks

LibriVox has public-domain audiobooks read by volunteers. Download a book's MP3 or M4B files, then tap **Add books**. Select all the files of one book together; they are combined into a single book.

## Run it

Requires Node.js. Under WSL, run these from the Linux shell.

```bash
npm install
npm run dev      # http://localhost:5173/Audiobook-player/
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint on `js/` |
| `npm test` | Vitest unit tests |

## Deploy

Every push to `master` runs `.github/workflows/deploy.yml`, which builds the site and publishes `dist/` to GitHub Pages. The app is served under `/Audiobook-player/` (set as `base` in `vite.config.js`).

## On iPhone

1. Open the app's address in Safari and tap **Share**, then **Add to Home Screen**.
2. Tap **Add books** and choose your audio files from Files (long-press to select several).
3. Re-adding a file that is already in the library is skipped.

Safari may clear a site's storage when the device is very low on space, so keep your original files.

## How it is built

Plain JavaScript ES modules with JSDoc comments, no framework, bundled by [Vite](https://vitejs.dev/). Libraries: [idb](https://github.com/jakearchibald/idb) (IndexedDB), [music-metadata](https://github.com/Borewit/music-metadata) and [jsmediatags](https://github.com/aadsm/jsmediatags) (tags, chapters, cover art), [epub.js](https://github.com/futurepress/epub.js) (EPUB), [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) (service worker). Tests use Vitest and fake-indexeddb.

- **Player store** (`js/services/player-store.js`) holds the one playback state. Views read it and send it commands.
- **Engines** (`js/engines/`) do the playing behind the store: `audio-engine.js` drives an `<audio>` element for audio files; `tts-engine.js` reads an EPUB with the built-in voice (`js/tts/`: a small narrator object over the Web Speech API).
- **IndexedDB** (`js/storage/library-db.js`) has two stores: `books` (metadata, covers, progress, bookmarks) and `files` (the audio or EPUB data, kept apart so book records stay small and are never rewritten with the file).
- **Views** (`js/views/`) are the library, Now playing, chapters sheet, mini player, shelf sheets, welcome screen and settings.

More detail for working on the code: [CLAUDE.md](CLAUDE.md) and [map/](map/CLAUDE.md).
