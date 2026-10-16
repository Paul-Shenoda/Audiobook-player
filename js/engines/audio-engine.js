import { updateBook as defaultUpdateBook } from '../storage/library-db.js';
import { createManagedObjectUrl, revokeManagedObjectUrl } from '../utils/object-url.js';
import { estimatePercent } from '../tts/playback-state.js';
import { createProgressSaver } from '../services/progress-saver.js';
import { clampSpeed } from '../utils/playback-speed.js';
import { createSleepTimer } from '../services/sleep-timer.js';

/**
 * @typedef {import('../storage/library-db.js').Book} Book
 * @typedef {import('../services/player-store.js').PlayerEngine} PlayerEngine
 */

// Smart resume: rewind a little so the listener regains context.
const RESTORE_REWIND_S = 10; // when reopening a book
const PAUSE_REWIND_S = 15; // when resuming after a long in-session pause
const LONG_PAUSE_MS = 5 * 60 * 1000;

/**
 * Audio engine for mp3/m4b/mp4 books (one or many files, one <audio> element).
 * It reports what the element really does through `emit`; the status is never
 * set by a command. Besides the PlayerState fields it emits `trackIndex`,
 * `trackSeconds` and `trackDuration` (position inside the current file) so
 * views can save bookmarks and feed the lock-screen scrubber.
 *
 * @param {{
 *   audio?: HTMLAudioElement,
 *   updateBook?: typeof defaultUpdateBook,
 *   createUrl?: (blob: Blob) => string,
 *   revokeUrl?: () => void,
 *   now?: () => number,
 * }} [deps] injectable for tests
 * @returns {PlayerEngine}
 */
export function createAudioEngine({
  audio = new Audio(),
  updateBook = defaultUpdateBook,
  createUrl = createManagedObjectUrl,
  revokeUrl = revokeManagedObjectUrl,
  now = Date.now,
} = {}) {
  /** @type {Book|null} */
  let book = null;
  let emit = () => {};
  let destroyed = false;
  let tracks = [];
  let trackIndex = 0;
  let rate = 1;
  let fileChapters = [];
  let hasTrackChapters = false;
  let hasFileChapters = false;
  // True once the current file's metadata has loaded (audio.duration is stale before that).
  let metaLoaded = false;
  /** @type {number|null} */
  let pausedAt = null;
  // Nothing is saved until the book has actually played in this session, so
  // opening and closing it doesn't store the 10 s restore rewind.
  let hasPlayed = false;
  /** @type {ReturnType<typeof createProgressSaver>|null} */
  let saver = null;
  // Chapter the 'end of chapter' sleep was set in (embedded chapters only).
  let sleepChapter = 0;
  const sleepTimer = createSleepTimer({
    onExpire: () => {
      audio.pause();
      emit({ sleep: { mode: 'off' } });
    },
  });
  /** @type {Array<[EventTarget, string, EventListener]>} */
  const listeners = [];

  function listen(target, type, fn) {
    target.addEventListener(type, fn);
    listeners.push([target, type, fn]);
  }

  const duration = () => (metaLoaded && Number.isFinite(audio.duration) ? audio.duration : 0);

  function fileChapterIndex() {
    let idx = 0;
    for (let i = 0; i < fileChapters.length; i += 1) {
      if (fileChapters[i].startSeconds <= audio.currentTime) idx = i;
      else break;
    }
    return idx;
  }

  /** Start and end (seconds in the current file) of a file chapter. */
  function fileChapterBounds(i) {
    const start = fileChapters[i].startSeconds;
    const end = i + 1 < fileChapters.length ? fileChapters[i + 1].startSeconds : duration();
    return { start, end };
  }

  function chapterList() {
    if (hasTrackChapters) {
      return tracks.map((t, i) => {
        const chapter = { title: t.label || `Track ${i + 1}` };
        const d = i === trackIndex && duration() ? duration() : t.duration;
        if (Number.isFinite(d)) chapter.duration = d;
        return chapter;
      });
    }
    if (hasFileChapters) {
      return fileChapters.map((c, i) => {
        const chapter = { title: c.title || `Chapter ${i + 1}` };
        const { start, end } = fileChapterBounds(i);
        if (end > start) chapter.duration = end - start;
        return chapter;
      });
    }
    return [];
  }

  /** Tell the store where we are. Chapter titles are only re-sent when they can change. */
  function publish({ withChapters = false } = {}) {
    const dur = duration();
    const time = audio.currentTime || 0;
    let chapterIndex = 0;
    let chapterElapsed = time;
    let chapterDuration = dur;
    if (hasTrackChapters) {
      chapterIndex = trackIndex;
    } else if (hasFileChapters) {
      chapterIndex = fileChapterIndex();
      const { start, end } = fileChapterBounds(chapterIndex);
      chapterElapsed = time - start;
      chapterDuration = Math.max(0, end - start);
    }
    const partial = {
      chapterIndex,
      chapterElapsed,
      chapterDuration,
      bookPercent: estimatePercent(trackIndex, tracks.length, time, dur || 1),
      trackIndex,
      trackSeconds: time,
      trackDuration: dur,
    };
    if (withChapters) partial.chapters = chapterList();
    emit(partial);
  }

  /**
   * Load a file by index. Setting both rates matters: browsers reset
   * playbackRate to defaultPlaybackRate whenever the source changes.
   * @param {number} index
   * @param {{ seconds?: number, autoplay?: boolean, onMetadata?: (duration: number) => number }} [options]
   *   onMetadata returns the start time once the file's length is known
   */
  function loadTrack(index, { seconds = 0, autoplay = false, onMetadata } = {}) {
    trackIndex = Math.min(Math.max(index, 0), tracks.length - 1);
    metaLoaded = false;
    audio.defaultPlaybackRate = rate;
    audio.src = createUrl(tracks[trackIndex].fileBlob);
    audio.playbackRate = rate;
    audio.currentTime = seconds;
    if (onMetadata) {
      const onLoaded = () => {
        audio.removeEventListener('loadedmetadata', onLoaded);
        audio.currentTime = onMetadata(audio.duration);
      };
      audio.addEventListener('loadedmetadata', onLoaded);
    }
    publish({ withChapters: true });
    if (autoplay) {
      emit({ status: 'loading' });
      startPlayback();
    }
  }

  function startPlayback() {
    // Status comes from the 'playing' event. A rejected play() (autoplay
    // policy, bad file) must not look like playback, so only fall back to paused.
    Promise.resolve(audio.play()).catch(() => {
      if (!destroyed) emit({ status: 'paused' });
    });
  }

  function saveProgress() {
    const dur = duration();
    if (!dur || !hasPlayed) return;
    const percent = estimatePercent(trackIndex, tracks.length, audio.currentTime, dur);
    updateBook(book.id, {
      lastOpenedAt: Date.now(),
      progress: { trackIndex, seconds: audio.currentTime, percent },
    }).catch(err => console.warn('Could not save progress', err));
  }

  // iOS Safari can reset playbackRate once metadata loads or once audio is
  // actually running ('playing', which comes after 'play'), so re-apply then,
  // and whenever something other than this engine changes it ('ratechange').
  function reapplySpeed() {
    if (audio.playbackRate !== rate) audio.playbackRate = rate;
  }

  function onPause() {
    // At the end of a file the 'ended' handler decides what happens next.
    if (audio.ended) return;
    pausedAt = now();
    saver.flush();
    emit({ status: 'paused' });
  }

  function currentChapter() {
    if (hasTrackChapters) return trackIndex;
    return hasFileChapters ? fileChapterIndex() : 0;
  }

  /** Stop for the 'end of chapter' sleep once playback has left the chapter it was set in. */
  function checkChapterSleep() {
    if (sleepTimer.getMode() !== 'chapter' || !hasFileChapters) return;
    const idx = fileChapterIndex();
    if (idx > sleepChapter) {
      audio.currentTime = fileChapters[idx].startSeconds;
      audio.pause();
      emit({ sleep: sleepTimer.set('off') });
    } else {
      sleepChapter = idx;
    }
  }

  function onEnded() {
    if (sleepTimer.getMode() === 'chapter' && hasTrackChapters && trackIndex < tracks.length - 1) {
      // Park at the start of the next track instead of rolling on.
      loadTrack(trackIndex + 1);
      emit({ status: 'paused', sleep: sleepTimer.set('off') });
      return;
    }
    if (trackIndex < tracks.length - 1) {
      loadTrack(trackIndex + 1, { autoplay: true });
      return;
    }
    saver.flush();
    emit({ status: 'paused', sleep: sleepTimer.set('off') });
    updateBook(book.id, { finishedAt: Date.now() }).catch(err => console.warn('Could not save finish', err));
  }

  const saveOnHidden = () => {
    if (document.visibilityState === 'hidden') saver.flush();
  };
  const saveOnPageHide = () => saver.flush();

  return {
    /** @param {Book} nextBook @param {(partial: object) => void} emitFn */
    load(nextBook, emitFn) {
      book = nextBook;
      emit = partial => {
        if (!destroyed) emitFn(partial);
      };
      tracks = book.tracks ?? [];
      if (!tracks.length) {
        emit({ status: 'error', error: 'This book has no audio files.' });
        return;
      }
      // In-file chapter markers only apply to a book with a single physical
      // track (e.g. an M4B); a multi-track book's tracks are its chapters.
      fileChapters = tracks.length === 1 ? (tracks[0]?.chapters ?? []) : [];
      hasTrackChapters = tracks.length > 1;
      hasFileChapters = !hasTrackChapters && fileChapters.length > 1;
      rate = clampSpeed(book.playbackRate);

      saver = createProgressSaver({ save: saveProgress });
      listen(audio, 'timeupdate', () => {
        saver.tick();
        publish();
        checkChapterSleep();
      });
      listen(audio, 'loadedmetadata', () => {
        metaLoaded = true;
        reapplySpeed();
        publish({ withChapters: true });
      });
      listen(audio, 'durationchange', () => {
        metaLoaded = true;
        publish({ withChapters: true });
      });
      listen(audio, 'seeked', () => {
        saver.flush();
        publish();
      });
      listen(audio, 'play', () => {
        hasPlayed = true;
        reapplySpeed();
      });
      listen(audio, 'playing', () => {
        reapplySpeed();
        emit({ status: 'playing' });
      });
      listen(audio, 'ratechange', reapplySpeed);
      // Buffering mid-play stays 'playing' so the Pause button keeps meaning pause.
      listen(audio, 'pause', onPause);
      listen(audio, 'ended', onEnded);
      listen(audio, 'error', () => {
        emit({ status: 'error', error: audio.error?.message || 'This audio file could not be played.' });
      });
      // Save every few seconds while playing, and immediately on pause, seek,
      // or when the app is hidden or closed (iOS gives no later chance to save).
      listen(document, 'visibilitychange', saveOnHidden);
      listen(window, 'pagehide', saveOnPageHide);

      const saved = book.progress;
      const startIndex = Math.min(Math.max(saved?.trackIndex ?? 0, 0), tracks.length - 1);
      const resume = startIndex === (saved?.trackIndex ?? 0) ? (saved?.seconds ?? 0) : 0;
      emit({ rate });
      loadTrack(startIndex, { seconds: Math.max(0, resume - RESTORE_REWIND_S) });
      emit({ status: 'paused' });
    },

    play() {
      if (pausedAt && now() - pausedAt > LONG_PAUSE_MS) {
        audio.currentTime = Math.max(0, audio.currentTime - PAUSE_REWIND_S);
      }
      pausedAt = null;
      startPlayback();
    },

    pause() {
      audio.pause();
    },

    /** @param {number} next */
    setRate(next) {
      rate = clampSpeed(next);
      audio.defaultPlaybackRate = rate;
      audio.playbackRate = rate;
      emit({ rate });
      updateBook(book.id, { playbackRate: rate }).catch(err => console.warn('Could not save speed', err));
    },

    /** @param {import('../services/sleep-timer.js').SleepMode} mode */
    setSleep(mode) {
      sleepChapter = currentChapter();
      emit({ sleep: sleepTimer.set(mode) });
    },

    /** Move by seconds, crossing files in a multi-file book; clamped to the book. */
    skip(seconds) {
      const dur = duration();
      const target = audio.currentTime + seconds;
      if (seconds < 0) {
        if (target >= 0 || trackIndex === 0) {
          audio.currentTime = Math.max(0, target);
          return;
        }
        // Land near the end of the previous file once its length is known.
        loadTrack(trackIndex - 1, {
          autoplay: !audio.paused,
          onMetadata: d => Math.max(0, d + target),
        });
        return;
      }
      if (!dur) return;
      if (target <= dur || trackIndex >= tracks.length - 1) {
        audio.currentTime = Math.min(dur, target);
        return;
      }
      loadTrack(trackIndex + 1, { seconds: target - dur, autoplay: !audio.paused });
    },

    /** @param {number} index */
    goToChapter(index) {
      if (hasTrackChapters) {
        if (index < 0 || index >= tracks.length) return;
        if (index === trackIndex) audio.currentTime = 0;
        else loadTrack(index, { autoplay: !audio.paused });
      } else if (hasFileChapters) {
        if (index < 0 || index >= fileChapters.length) return;
        audio.currentTime = fileChapters[index].startSeconds;
        sleepChapter = index;
        publish();
      }
    },

    /** @param {number} fraction 0-1 within the current chapter */
    seekInChapter(fraction) {
      const dur = duration();
      if (!dur) return;
      const f = Math.min(Math.max(fraction, 0), 1);
      if (hasFileChapters) {
        const { start, end } = fileChapterBounds(fileChapterIndex());
        audio.currentTime = start + f * (end - start);
      } else {
        audio.currentTime = f * dur;
      }
      publish();
    },

    destroy() {
      if (destroyed) return;
      saver?.flush();
      saver?.dispose();
      sleepTimer.destroy();
      for (const [target, type, fn] of listeners) target.removeEventListener(type, fn);
      listeners.length = 0;
      destroyed = true;
      audio.pause();
      audio.removeAttribute?.('src');
      revokeUrl();
    },
  };
}
