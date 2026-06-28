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
  // Blob URL is more reliable than passing an ArrayBuffer directly to epubjs,
  // especially in Vite-bundled environments. We attach it to the book so
  // destroyEpub can revoke it when the book is no longer needed.
  let url;
  if (source instanceof ArrayBuffer) {
    const blob = new Blob([source], { type: 'application/epub+zip' });
    url = URL.createObjectURL(blob);
  } else {
    url = URL.createObjectURL(source);
  }
  const book = ePub(url);
  book.__blobUrl = url;
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

const FRONT_MATTER_RE = /^\s*(cover|title\s*page?|half[\s-]?title|copyright|dedication|contents|table\s*of\s*contents?|toc|foreword|preface|acknowledgements?|about\s*(the\s*)?(author|book)|epigraph|also\s*by|frontispiece|series|halftitle|praise|from\s*the\s*publisher|note\s*to\s*reader|permissions|credits)\s*$/i;

/**
 * Walk the EPUB navigation TOC and return the spine index of the first chapter
 * that is not front matter (cover, copyright, TOC, foreword, etc.).
 * Falls back to 0 when no navigation data is available.
 * @param {import('epubjs').Book} book
 * @returns {Promise<number>}
 */
export async function findFirstContentChapter(book) {
  let toc = [];
  try {
    const nav = await book.loaded.navigation;
    toc = nav?.toc ?? [];
  } catch {
    return 0;
  }
  if (!toc.length) return 0;

  // Flatten nested TOC into a single ordered list.
  const flatToc = [];
  function flatten(items) {
    for (const item of items) {
      flatToc.push(item);
      if (item.subitems?.length) flatten(item.subitems);
    }
  }
  flatten(toc);

  // Build a map from normalised href → spine index so we can translate a TOC
  // entry back to a spine position.
  const spineItems = book.spine.items ?? [];
  const hrefToIndex = new Map();
  for (let i = 0; i < spineItems.length; i++) {
    const raw = spineItems[i].href ?? '';
    const norm = raw.split('#')[0];
    hrefToIndex.set(norm.toLowerCase(), i);
    // Also index by filename alone for loose matching.
    const filename = norm.split('/').pop();
    if (filename && !hrefToIndex.has(filename.toLowerCase())) {
      hrefToIndex.set(filename.toLowerCase(), i);
    }
  }

  function spineIndexForHref(href) {
    const base = (href ?? '').split('#')[0];
    const exact = hrefToIndex.get(base.toLowerCase());
    if (exact !== undefined) return exact;
    const byFile = hrefToIndex.get(base.split('/').pop().toLowerCase());
    return byFile ?? -1;
  }

  for (const item of flatToc) {
    const label = (item.label ?? '').trim();
    if (!FRONT_MATTER_RE.test(label)) {
      const idx = spineIndexForHref(item.href);
      if (idx >= 0) return idx;
    }
  }

  return 0;
}

/**
 * Destroy an open EPUB book instance and revoke any associated Blob URL.
 * @param {import('epubjs').Book|null} book
 */
export function destroyEpub(book) {
  if (book) {
    if (book.__blobUrl) {
      URL.revokeObjectURL(book.__blobUrl);
    }
    book.destroy();
  }
}
