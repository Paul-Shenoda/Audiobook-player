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

  return importMp3(file);
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
 */
async function importMp3(file) {
  let title = file.name.replace(/\.mp3$/i, '');
  let author = 'Unknown Artist';

  await new Promise((resolve) => {
    jsmediatags.read(file, {
      onSuccess(tag) {
        title = tag.tags.title || title;
        author = tag.tags.artist || author;
        resolve();
      },
      onError(error) {
        console.warn('[Import] Could not read ID3 tags for', file.name, error.type, error.info);
        resolve();
      },
    });
  });

  const coverBlob = await generateFallbackCover(title, author);

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
  let coverBlob = await extractCoverBlob(book, metadata.coverUrl);
  destroyEpub(book);

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
