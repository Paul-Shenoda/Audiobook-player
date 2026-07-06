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
  // epubjs sniffs string inputs by file extension, so an extensionless blob
  // URL is misread as a directory and book.ready never settles. Passing the
  // raw ArrayBuffer forces archived (binary) mode.
  const buffer =
    source instanceof ArrayBuffer ? source : await source.arrayBuffer();
  const book = ePub(buffer);

  try {
    await whenBookReady(book);
  } catch (err) {
    book.destroy();
    throw err;
  }

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

const OPEN_TIMEOUT_MS = 30000;

/**
 * Wait for book.ready, but surface failures: epubjs never rejects its opening
 * promise — it only emits "openFailed" — so a bad file would hang forever.
 * @param {import('epubjs').Book} book
 * @returns {Promise<void>}
 */
function whenBookReady(book) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out opening EPUB — the file may be corrupt or DRM-protected'));
    }, OPEN_TIMEOUT_MS);

    book.on('openFailed', (err) => {
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    });

    Promise.resolve(book.ready).then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
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

  const flatToc = flattenToc(toc);
  const spineIndexForHref = buildSpineHrefResolver(book);

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
 * Flatten a nested TOC into a single ordered list.
 * @param {Array} toc
 */
function flattenToc(toc) {
  const flat = [];
  function walk(items) {
    for (const item of items) {
      flat.push(item);
      if (item.subitems?.length) walk(item.subitems);
    }
  }
  walk(toc);
  return flat;
}

/**
 * Build a resolver from a TOC href to its spine index, matching by
 * normalised path with a filename-only fallback.
 * @param {import('epubjs').Book} book
 * @returns {(href: string) => number} -1 when unmatched
 */
function buildSpineHrefResolver(book) {
  const spineItems = book.spine.items ?? [];
  const hrefToIndex = new Map();
  for (let i = 0; i < spineItems.length; i++) {
    const raw = spineItems[i].href ?? '';
    const norm = raw.split('#')[0];
    hrefToIndex.set(norm.toLowerCase(), i);
    const filename = norm.split('/').pop();
    if (filename && !hrefToIndex.has(filename.toLowerCase())) {
      hrefToIndex.set(filename.toLowerCase(), i);
    }
  }

  return function spineIndexForHref(href) {
    const base = (href ?? '').split('#')[0];
    const exact = hrefToIndex.get(base.toLowerCase());
    if (exact !== undefined) return exact;
    const byFile = hrefToIndex.get(base.split('/').pop().toLowerCase());
    return byFile ?? -1;
  };
}

/**
 * @typedef {Object} ChapterEntry
 * @property {number} spineIndex
 * @property {string} label real TOC title when available, else "Chapter N"
 */

/**
 * One entry per spine chapter, labelled from the navigation TOC where a
 * matching entry exists.
 * @param {import('epubjs').Book} book
 * @returns {Promise<ChapterEntry[]>}
 */
export async function getChapterList(book) {
  const spineItems = book.spine.items ?? [];
  const chapters = spineItems.map((_, i) => ({
    spineIndex: i,
    label: `Chapter ${i + 1}`,
    hasTocLabel: false,
  }));

  let toc = [];
  try {
    const nav = await book.loaded.navigation;
    toc = nav?.toc ?? [];
  } catch {
    return chapters;
  }

  const spineIndexForHref = buildSpineHrefResolver(book);
  for (const item of flattenToc(toc)) {
    const label = (item.label ?? '').trim();
    if (!label) continue;
    const idx = spineIndexForHref(item.href);
    if (idx >= 0 && !chapters[idx].hasTocLabel) {
      chapters[idx].label = label;
      chapters[idx].hasTocLabel = true;
    }
  }

  return chapters;
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
