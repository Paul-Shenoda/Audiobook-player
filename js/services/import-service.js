import jsmediatags from 'jsmediatags';
import { parseBlob } from 'music-metadata';
import { addBook, getAllBooks } from '../storage/library-db.js';
import {
  openEpub,
  extractCoverBlob,
  destroyEpub,
} from '../epub/epub-loader.js';
import { generateFallbackCover } from '../utils/cover-fallback.js';

/**
 * @typedef {import('../storage/library-db.js').Book} Book
 */

/**
 * @typedef {Object} ImportResult
 * @property {Book[]} added
 * @property {{ name: string, reason: string }[]} skipped
 * @property {{ name: string, error: string }[]} failed
 */

/**
 * @param {Book[]} existing
 * @param {File} file
 */
export function isDuplicate(existing, file) {
  return existing.some((b) => {
    if (b.tracks?.length) {
      return b.tracks.some(
        (t) => t.sourceFileName === file.name && t.sourceFileSize === file.size,
      );
    }
    return b.sourceFileName === file.name && b.sourceFileSize === file.size;
  });
}

/**
 * @param {File} file
 * @param {Book[]} existing
 * @returns {Promise<Book>}
 */
export async function importSingleFile(file, existing) {
  if (isDuplicate(existing, file)) {
    throw new Error('duplicate');
  }

  const isEpub =
    file.name.toLowerCase().endsWith('.epub') ||
    file.type === 'application/epub+zip';

  if (isEpub) {
    return importEpub(file);
  }

  if (!isAudioFile(file)) {
    throw new Error('Unsupported file type — use MP3, M4B, M4A, or EPUB');
  }

  return importAudio(file);
}

const AUDIO_EXT_RE = /\.(mp3|m4b|m4a|aac|wav|ogg|opus|flac)$/i;

/**
 * @param {File} file
 */
export function isAudioFile(file) {
  return AUDIO_EXT_RE.test(file.name) || file.type.startsWith('audio/');
}

/**
 * Convert a jsmediatags picture (ID3 APIC / MP4 covr) to a Blob.
 * @param {{ format?: string, data?: number[] }|undefined} picture
 * @returns {Blob|null}
 */
export function pictureToBlob(picture) {
  if (!picture?.data?.length) return null;
  let type = picture.format || 'image/jpeg';
  if (type === 'image/jpg') type = 'image/jpeg';
  if (!type.startsWith('image/')) type = `image/${type}`;
  return new Blob([new Uint8Array(picture.data)], { type });
}

/**
 * @param {FileList|File[]} files
 * @param {(current: number, total: number, fileName: string) => void} [onProgress]
 * @returns {Promise<ImportResult>}
 */
export async function importBooks(files, onProgress) {
  const list = Array.from(files);
  const existing = await getAllBooks();
  const result = { added: [], skipped: [], failed: [] };

  for (let i = 0; i < list.length; i += 1) {
    const file = list[i];
    onProgress?.(i + 1, list.length, file.name);

    if (isDuplicate(existing, file)) {
      result.skipped.push({ name: file.name, reason: 'Already in library' });
      continue;
    }

    try {
      const book = await importSingleFile(file, existing);
      existing.unshift(book);
      result.added.push(book);
    } catch (err) {
      if (err instanceof Error && err.message === 'duplicate') {
        result.skipped.push({ name: file.name, reason: 'Already in library' });
      } else {
        result.failed.push({
          name: file.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return result;
}

/**
 * @param {File} file
 * @returns {Promise<{ title: string, author: string, coverBlob: Blob|null }>}
 */
function readAudioTags(file) {
  return new Promise((resolve) => {
    jsmediatags.read(file, {
      onSuccess(tag) {
        resolve({
          title: tag.tags.title || null,
          author: tag.tags.artist || null,
          coverBlob: pictureToBlob(tag.tags.picture),
        });
      },
      onError() {
        resolve({ title: null, author: null, coverBlob: null });
      },
    });
  });
}

const M4B_EXT_RE = /\.(m4b|m4a)$/i;

/**
 * Best-effort in-file chapter markers for an M4B/M4A — most audiobook
 * tools (e.g. ffmpeg, m4b-tool) write the Nero `chpl` atom, which
 * music-metadata cannot read; it only supports QuickTime chapter *tracks*.
 * Returns `[]` whenever chapters aren't found or parsing fails, so callers
 * can treat this purely as an enhancement — the book still imports and
 * plays fine as a single track either way.
 * @param {File} file
 * @returns {Promise<import('../storage/library-db.js').FileChapter[]>}
 */
export async function readM4bChapters(file) {
  if (!M4B_EXT_RE.test(file.name)) return [];
  try {
    const metadata = await parseBlob(file, { includeChapters: true, duration: false });
    const chapters = metadata.format.chapters ?? [];
    if (chapters.length < 2) return [];
    return chapters.map((c, i) => ({
      title: c.title || `Chapter ${i + 1}`,
      startSeconds: c.timeScale ? c.start / c.timeScale : c.start,
    }));
  } catch {
    return [];
  }
}

/**
 * MP3/M4B/M4A import — jsmediatags reads both ID3 and MP4 metadata.
 * Stored as type 'mp3' (the app's generic audio type), as a single-entry
 * `tracks` array — see `importCombinedAudiobook` for the multi-track path.
 * @param {File} file
 */
async function importAudio(file) {
  const fallbackTitle = file.name.replace(AUDIO_EXT_RE, '');
  const [tags, chapters] = await Promise.all([readAudioTags(file), readM4bChapters(file)]);
  const title = tags.title || fallbackTitle;
  const author = tags.author || 'Unknown Artist';
  const coverBlob = tags.coverBlob || (await generateFallbackCover(title, author));

  return addBook({
    type: 'mp3',
    title,
    author,
    coverBlob,
    tracks: [
      {
        fileBlob: file,
        sourceFileName: file.name,
        sourceFileSize: file.size,
        label: tags.title || fallbackTitle,
        ...(chapters.length ? { chapters } : {}),
      },
    ],
  });
}

/**
 * Combine several audio files, selected together in one explicit action,
 * into a single multi-track audiobook (one track per file, in the order
 * given — callers should natural-sort first, see `naturalSortFiles`). This
 * is opt-in and separate from the default `importBooks` flow, which always
 * treats each selected audio file as its own book.
 * @param {File[]} files in desired track order
 * @param {{ title?: string, author?: string }} [overrides] falls back to the
 *   first file's tags/filename when omitted
 * @returns {Promise<Book>}
 */
export async function importCombinedAudiobook(files, overrides = {}) {
  const tagsPerFile = await Promise.all(files.map(readAudioTags));
  const first = tagsPerFile[0];
  const fallbackTitle = files[0].name.replace(AUDIO_EXT_RE, '');
  const title = overrides.title || first?.title || fallbackTitle;
  const author = overrides.author || first?.author || 'Unknown Artist';
  const coverBlob =
    tagsPerFile.find((t) => t.coverBlob)?.coverBlob || (await generateFallbackCover(title, author));

  const tracks = files.map((file, i) => ({
    fileBlob: file,
    sourceFileName: file.name,
    sourceFileSize: file.size,
    label: tagsPerFile[i].title || file.name.replace(AUDIO_EXT_RE, ''),
  }));

  return addBook({ type: 'mp3', title, author, coverBlob, tracks });
}

/**
 * Natural sort (so "Chapter 2" sorts before "Chapter 10") — the default
 * track order for `importCombinedAudiobook` before a user reorders anything.
 * @param {File[]} files
 * @returns {File[]}
 */
export function naturalSortFiles(files) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...files].sort((a, b) => collator.compare(a.name, b.name));
}

/**
 * @param {File} file
 */
async function importEpub(file) {
  const arrayBuffer = await file.arrayBuffer();
  const { book, metadata } = await openEpub(arrayBuffer);
  let coverBlob;
  try {
    coverBlob = await extractCoverBlob(book, metadata.coverUrl);
  } finally {
    destroyEpub(book);
  }

  if (!coverBlob) {
    coverBlob = await generateFallbackCover(metadata.title, metadata.author);
  }

  return addBook({
    type: 'epub',
    title: metadata.title,
    author: metadata.author,
    fileBlob: file,
    coverBlob,
    sourceFileName: file.name,
    sourceFileSize: file.size,
  });
}
