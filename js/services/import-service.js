import jsmediatags from 'jsmediatags';
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
  return existing.some(
    (b) =>
      b.sourceFileName === file.name &&
      b.sourceFileSize === file.size,
  );
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
 * MP3/M4B/M4A import — jsmediatags reads both ID3 and MP4 metadata.
 * Stored as type 'mp3' (the app's generic audio type).
 * @param {File} file
 */
async function importAudio(file) {
  let title = file.name.replace(AUDIO_EXT_RE, '');
  let author = 'Unknown Artist';
  /** @type {Blob|null} */
  let coverBlob = null;

  await new Promise((resolve) => {
    jsmediatags.read(file, {
      onSuccess(tag) {
        title = tag.tags.title || title;
        author = tag.tags.artist || author;
        coverBlob = pictureToBlob(tag.tags.picture);
        resolve();
      },
      onError() {
        resolve();
      },
    });
  });

  if (!coverBlob) {
    coverBlob = await generateFallbackCover(title, author);
  }

  return addBook({
    type: 'mp3',
    title,
    author,
    fileBlob: file,
    coverBlob,
    sourceFileName: file.name,
    sourceFileSize: file.size,
  });
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
