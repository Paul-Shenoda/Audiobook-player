import ePub from 'epubjs';
import { htmlToPlainText } from './text-extract.js';

/**
 * @typedef {Object} EpubMetadata
 * @property {string} title
 * @property {string} author
 * @property {string|null} coverUrl
 * @property {number} spineLength
 */

/**
 * Open an EPUB from a File or ArrayBuffer.
 * @param {File|ArrayBuffer} source
 * @returns {Promise<{ book: import('epubjs').Book, metadata: EpubMetadata }>}
 */
export async function openEpub(source) {
  const book = ePub(source);
  await book.ready;

  const metadata = await book.loaded.metadata;
  const title = metadata.title || 'Untitled';
  const author = metadata.creator || metadata.author || 'Unknown Author';

  let coverUrl = null;
  try {
    const cover = await book.coverUrl();
    if (cover) {
      coverUrl = cover;
    }
  } catch {
    // Cover is optional
  }

  if (!coverUrl) {
    coverUrl = await findCoverFromManifest(book);
  }

  const spineLength = book.spine?.length ?? 0;

  return {
    book,
    metadata: { title, author, coverUrl, spineLength },
  };
}

/**
 * Load plain text for a spine chapter index.
 * @param {import('epubjs').Book} book
 * @param {number} chapterIndex
 * @returns {Promise<string>}
 */
export async function loadChapterText(book, chapterIndex) {
  const section = book.spine.get(chapterIndex);
  if (!section) {
    throw new Error(`Chapter ${chapterIndex} not found`);
  }

  const contents = await section.load(book.load.bind(book));
  let html = '';

  if (typeof contents === 'string') {
    html = contents;
  } else if (contents?.documentElement) {
    html = contents.documentElement.outerHTML;
  } else if (contents?.outerHTML) {
    html = contents.outerHTML;
  } else {
    html = String(contents ?? '');
  }

  section.unload();

  return htmlToPlainText(html);
}

/**
 * Try OPF manifest / meta for cover href when coverUrl() fails.
 * @param {import('epubjs').Book} book
 * @returns {Promise<string|null>}
 */
async function findCoverFromManifest(book) {
  try {
    const packaging = await book.loaded.packaging;
    const manifest = packaging?.manifest ?? {};
    const meta = await book.loaded.metadata;

    const coverId =
      meta?.cover ||
      Object.values(manifest).find((item) => item.properties?.includes('cover-image'))?.id;

    if (coverId && manifest[coverId]?.href) {
      return book.path.resolve(manifest[coverId].href);
    }

    const imageItem = Object.values(manifest).find((item) =>
      /\.(jpg|jpeg|png|gif|webp)$/i.test(item.href ?? ''),
    );
    if (imageItem?.href) {
      return book.path.resolve(imageItem.href);
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Fetch cover as Blob for storage.
 * @param {string|null} coverUrl
 * @returns {Promise<Blob|null>}
 */
export async function fetchCoverBlob(coverUrl) {
  if (!coverUrl) return null;
  try {
    const response = await fetch(coverUrl);
    if (!response.ok) return null;
    return await response.blob();
  } catch {
    return null;
  }
}

/**
 * Extract embedded cover blob using URL or manifest fallbacks.
 * @param {import('epubjs').Book} book
 * @param {string|null} coverUrl
 * @returns {Promise<Blob|null>}
 */
export async function extractCoverBlob(book, coverUrl) {
  let blob = await fetchCoverBlob(coverUrl);
  if (blob) return blob;

  const altUrl = await findCoverFromManifest(book);
  return fetchCoverBlob(altUrl);
}

/**
 * Destroy an open EPUB book instance.
 * @param {import('epubjs').Book|null} book
 */
export function destroyEpub(book) {
  if (book) {
    book.destroy();
  }
}
