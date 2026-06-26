# Personal Audiobook Library

A client-side web app for personal use: play local MP3 audiobooks, import EPUB ebooks, and listen via built-in or AI text-to-speech. Inspired by Audible's library layout — no accounts, no cloud, all data stays in your browser.

## Features

- **Library home** — grid of covers, "Continue Listening" row, MP3/EPUB format badges
- **MP3 playback** — ID3 metadata, play/pause, seek, ±15s skip, progress saved to IndexedDB
- **EPUB listen mode** — extracts text from spine chapters, reads aloud via Web Speech or OpenAI TTS
- **AI narrator (optional)** — OpenAI TTS with local dev proxy and IndexedDB audio chunk cache
- **Persistent library** — books stored in IndexedDB (files + covers + progress)

## Tech Stack

- HTML5, CSS3, vanilla ES modules
- [Vite](https://vitejs.dev/) — dev server and bundler
- [jsmediatags](https://github.com/aadsm/jsmediatags) — MP3 ID3 tags
- [epub.js](https://github.com/futurepress/epub.js) — EPUB parsing
- [idb](https://github.com/jakearchibald/idb) — IndexedDB wrapper
- Vitest + ESLint

## Getting Started

Node.js is required. If you use **WSL**, run these commands from your Linux shell:

```bash
source ~/.nvm/nvm.sh   # if using nvm
cd /mnt/c/Users/pauls/Documents/projects/Audiobook_WebApp
npm install
npm run dev
```

Open the URL shown in the terminal (usually `http://localhost:5173`).

### Optional: OpenAI TTS

1. Copy `.env.example` to `.env` and set `OPENAI_API_KEY=sk-...`
2. In the app, open **Settings** → select **OpenAI TTS** → enter your API key (or rely on the server proxy key)
3. The dev server proxies `/api/tts` to OpenAI so keys are not exposed in production builds

For production, run your own backend proxy — do not embed API keys in the frontend bundle.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview production build |
| `npm run lint` | ESLint on `js/` |
| `npm run test` | Run Vitest unit tests |

## How to Use

### iPhone (Safari)

1. Open the app URL on your iPhone (same Wi‑Fi as your dev machine, or a deployed host).
2. Tap **Share** → **Add to Home Screen** for an app-like experience.
3. Open the app → tap **Add Books**.
4. In the Files picker: **Browse** → **On My iPhone** (or iCloud Drive).
5. Select **one or many** `.epub` files (long-press to multi-select).
6. Books appear in your library grid — tap any cover to listen.

Re-importing the same file is skipped automatically (matched by filename and size).

### Desktop

1. Click **Add Books** and select `.mp3` or `.epub` files (multiple allowed).
2. MP3 opens the audio player; EPUB opens listen mode.
3. For EPUB: tap **Listen** to start Web Speech narration.
4. Use **Settings** to switch to OpenAI TTS for higher-quality voices.
5. Use the **···** menu on a book card to remove it from the library.

### Mini player

When listening, tap **Library** to browse while audio continues. A bar at the bottom shows the current book with play/pause.

## Storage Notes

Books and generated TTS audio are stored in IndexedDB. Browser storage limits apply (typically hundreds of MB). **On iPhone Safari**, storage may be cleared if the device is low on space — keep important originals in the Files app. DRM-protected EPUBs are not supported.

## Test EPUBs

Use DRM-free books from [Standard Ebooks](https://standardebooks.org/) or Project Gutenberg.
