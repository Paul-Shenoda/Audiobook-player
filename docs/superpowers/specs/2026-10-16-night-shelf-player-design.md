# Night Shelf: one player, one playback state

Date: 2026-10-16 · Branch: `night-shelf` · Design source: claude.ai Design canvas "Audiobook Player Redesign", artboards "Revised: Night Shelf"

## Goal

1. The mini player, the Now playing screen and the iOS lock screen always show the same play/pause state.
2. EPUB speed changes apply while speaking (no Stop needed) and are remembered per book.
3. The app looks like Night Shelf: one shared Now playing screen for audio books and EPUBs.

Out of scope (later): Audiblez / Kokoro narration, background playback on iOS, offline testing,
Shelves, Narrators, editable bookmark notes, volume slider.

## Delivery

All work happens on branch `night-shelf`. `master` (the live app linked from the portfolio) stays
untouched until the whole branch has been tested on the owner's iPhone. Nothing is pushed without
the owner's yes.

## Architecture

```
views (now-playing, mini-player, library, chapters-sheet)
   │ subscribe(state)            ▲ commands: play/pause/toggle/setRate/skip/chapter/seek
   ▼                             │
player-store.js  ── one source of truth, many subscribers
   │ loads one engine per book
   ├── audio-engine.js   (mp3/m4b/mp4 files, one <audio> element)
   └── tts-engine.js     (EPUB text → TTSRouter → Web Speech / AI provider)
media-session.js is wired once to the store, not per view.
```

### `js/services/player-store.js` (replaces `playback-manager.js`)

- `getState()`, `subscribe(fn) → unsubscribe`. Any number of subscribers; each gets the full state.
- State: `{ book, kind: 'audio'|'epub'|null, status: 'idle'|'loading'|'playing'|'paused'|'error',
  error, rate, chapters: [{ title, duration? }], chapterIndex, chapterElapsed, chapterDuration,
  bookPercent, readAlong: { chunks, chunkIndex } | null, sleep }`.
  For EPUBs, times are estimates from character counts (existing `estimateSecondsRemaining`).
- Commands: `open(book)`, `play()`, `pause()`, `toggle()`, `setRate(r)`, `skip(seconds)`,
  `nextChapter()`, `prevChapter()`, `goToChapter(i)`, `seekInChapter(fraction)`, `stop()`, `close()`.
  Views never touch `<audio>`, `speechSynthesis` or `TTSRouter` directly.
- `open(book)` on the book already loaded is a no-op (keeps the Safari stale-Blob fix from 19626d5).
- Status is set from what the engine reports (e.g. `<audio>` `playing`/`pause` events, TTS chunk
  start / cancel), never optimistically by a button handler. This is what fixes the desync.

### Engines (same interface)

`load(book, emit)`, `play()`, `pause()`, `setRate(r)`, `skip(seconds)`, `goToChapter(i)`,
`seekInChapter(f)`, `destroy()`. `emit(partialState)` updates the store.
Each engine owns its progress saving (existing `progress-saver.js`) and sleep timer hooks.

- `js/engines/audio-engine.js`: logic moved out of `views/mp3-player.js` (tracks, file chapters,
  speed re-apply on `playing`/`ratechange`, progress, `ended`).
- `js/engines/tts-engine.js`: logic moved out of `views/epub-listen.js` (open EPUB, chapter list,
  front-matter skip, chunking, continuous chapter roll-over, progress in localStorage).
  `skip(±s)` moves by whole chunks using the per-chunk time estimate.

### EPUB speed fixes (in `tts-engine.js` / `web-speech.js`)

- **Live rate change:** `setRate` while speaking cancels the current utterance and re-speaks the
  current chunk from its start at the new rate. Each utterance carries a generation id; events
  from a cancelled utterance (`end`, `error: interrupted/canceled`) are ignored, so a cancel never
  advances the queue.
- **Pause on Web Speech:** `pause()` = cancel and remember the chunk; `resume()` re-speaks that
  chunk. iOS `speechSynthesis.pause/resume` is unreliable; restarting a sentence is acceptable.
- **Per-book speed bug (likely cause, confirm with a test first):** `epub-listen.js:163` falls back
  to `loadTTSSettings().rate` for books without their own speed; older builds saved EPUB speed into
  that global, and `TTSRouter.setRate` also mutates the shared in-memory `settings.rate`. Fix: a book
  with no saved speed starts at 1×; the router's rate is per session, not written to settings.

### Views

- `views/now-playing.js`: one screen for both kinds (Revised-Player artboard). Cover ↔ read-along
  toggle (read-along only for EPUBs; hidden for audio), chapter label "Chapter n of N",
  bookmark-here button, chapter scrubber with elapsed / remaining, book-progress line
  ("42% of book, about 14 h left"), prev chapter / back 15 / play / forward 30 / next chapter,
  bottom row: Speed (opens a small picker of the existing steps; EPUB max 2×), Sleep, Chapters, Read along.
- `views/chapters-sheet.js`: bottom sheet with Chapters / Bookmarks tabs (Revised-Chapters artboard),
  using the existing bookmark storage. No note editing.
- `views/mini-player.js`: subscribes to the store; restyled per the Library artboard's bottom bar.
- `views/library.js`: restyled per Revised-Library (phone) and Revised-Desktop (≥1024px: left
  sidebar with Library / Bookmarks / Settings, grid, persistent bottom player bar). Shelves and
  Narrators are not shown.
- `views/settings.js`: picks up the new tokens only; no layout work.
- Delete `views/mp3-player.js` and `views/epub-listen.js` once Now playing replaces them.

### Look

- `css/tokens.css`: Night Shelf colours as CSS variables (`--bg #17141F`, `--surface #221E2C`,
  `--surface-2 #2E2939`, `--ink #F1ECE4`, `--ink-2 #D5CEDF`, `--muted #ABA3B8`, `--rule #4A4358`,
  `--track #3A3446`, `--accent #F4B54A`, `--on-accent #2A1B05`, `--cover-teal #1F4E5F`), radii, spacing.
  Existing CSS switches to these variables; no hex values in view CSS.
- Fonts: Bricolage Grotesque (headings) + Atkinson Hyperlegible (body) from Google Fonts, `display=swap`,
  system-font fallback. **Needs owner OK.** Service worker should cache them for offline.
- Icons: inline stroke SVGs in `utils/icons.js` (add what Night Shelf uses). No emoji.
- Touch targets ≥ 44px, visible focus ring in accent, `prefers-reduced-motion` respected.
- The artboards are reference HTML: copy colours, sizes and structure, not the canvas runtime markup.

## Testing

- Vitest (jsdom) unit tests, written first, for: store subscribe/commands/status-from-engine,
  open-same-book no-op, tts-engine live rate change (fake `speechSynthesis` that fires `end` on
  cancel, as Safari does), pause/resume restart, per-book speed default, audio-engine status from
  `<audio>` events, chunk-based skip.
- Every task ends green on `npm test`, `npm run lint`, `npm run build`.
- One Playwright pass at 390px and 1440px at the end (not per task).
- Owner's iPhone test before merging to `master`.

## Tasks (one Sonnet agent each, run one after another; I review each diff before the next)

1. Store + tests (`player-store.js`); keep `playbackManager` working as a thin shim for now.
2. TTS engine extracted from `epub-listen.js` + speed fixes + tests. Old EPUB view drives it via the store.
3. Audio engine extracted from `mp3-player.js` + tests. Old audio view drives it via the store.
   Mini player subscribes to the store. **Checkpoint: desync and speed fixes testable on iPhone.**
4. Night Shelf foundation: `tokens.css`, fonts, icons, base styles.
5. Now playing view + chapters/bookmarks sheet; media session wired to the store; routing in
   `main.js`; delete the two old player views and the shim.
6. Mini player bar + Library (phone) restyle.
7. Desktop layout (sidebar + bottom player bar) and settings token pass.
8. Final pass: Playwright check at 390/1440, README update.

Agents get: this spec, the artboard files (copied into `docs/design/night-shelf/`), and the rule
to keep JS (no TypeScript), no new npm packages, and match the existing code style.
