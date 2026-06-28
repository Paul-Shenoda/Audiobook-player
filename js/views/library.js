import {
  getAllBooks,
  deleteBook,
} from '../storage/library-db.js';
import { importBooks } from '../services/import-service.js';
import { clearBookCache } from '../tts/chunk-cache.js';
import { showToast } from '../utils/toast.js';
import { icon } from '../utils/icons.js';
import {
  renderCoverMarkup,
  hydrateCoverUrls,
  revokeFallbackCoverUrl,
  getBookCoverUrl,
} from '../utils/cover-art.js';

/**
 * @typedef {import('../storage/library-db.js').Book} Book
 */

/** @type {'all'|'epub'|'mp3'} */
let activeFilter = 'all';

/**
 * @param {HTMLElement} container
 * @param {{ onOpenBook: (book: Book) => void, onOpenSettings: () => void }} callbacks
 */
export async function renderLibrary(container, { onOpenBook, onOpenSettings }) {
  const books = await getAllBooks();
  const filtered = filterBooks(books, activeFilter);
  const continueBook = books[0] ?? null;
  const recentBooks = [...books]
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, 8);

  container.innerHTML = `
    <div class="library-view">
      <header class="library-header">
        <h1 class="library-title">My Library</h1>
        <div class="header-actions">
          <button class="icon-btn-touch" id="settings-btn" type="button" aria-label="Settings">${icon('settings')}</button>
          <label class="import-btn primary-btn">
            ${icon('add', 20)} Add Books
            <input type="file" id="import-input" accept=".mp3,audio/mpeg,.epub,application/epub+zip" multiple class="visually-hidden">
          </label>
        </div>
      </header>

      <p class="import-hint">On iPhone: Files → On My iPhone → select one or more EPUBs</p>

      <div id="import-status" class="import-status" hidden></div>

      <div class="filter-tabs" role="tablist">
        ${renderFilterTab('all', 'All', activeFilter)}
        ${renderFilterTab('epub', 'EPUB', activeFilter)}
        ${renderFilterTab('mp3', 'MP3', activeFilter)}
      </div>

      ${continueBook ? renderContinueRow(continueBook) : ''}

      ${recentBooks.length > 1 ? renderRecentShelf(recentBooks) : ''}

      <section class="library-section">
        <h2 class="section-heading">Your Library</h2>
        ${filtered.length ? renderBookGrid(filtered) : renderEmptyState(activeFilter)}
      </section>

      ${isIOS() ? '<p class="storage-notice">Books are stored in this browser. Safari may free space if storage is low.</p>' : ''}
    </div>
  `;

  await hydrateCoverUrls(filtered);
  patchCoversInDom(container, [...filtered, ...(continueBook ? [continueBook] : []), ...recentBooks]);

  container.querySelector('#settings-btn').addEventListener('click', onOpenSettings);

  container.querySelectorAll('.filter-tab').forEach((tab) => {
    tab.addEventListener('click', async () => {
      activeFilter = tab.getAttribute('data-filter') ?? 'all';
      await renderLibrary(container, { onOpenBook, onOpenSettings });
    });
  });

  container.querySelector('#import-input').addEventListener('change', async (event) => {
    const input = event.target;
    const files = input.files;
    if (!files?.length) return;

    const statusEl = container.querySelector('#import-status');
    statusEl.hidden = false;
    statusEl.textContent = `Importing 0 of ${files.length}…`;

    const result = await importBooks(files, (current, total, name) => {
      statusEl.textContent = `Importing ${current} of ${total}: ${name}`;
    });

    input.value = '';

    const parts = [];
    if (result.added.length) parts.push(`${result.added.length} added`);
    if (result.skipped.length) parts.push(`${result.skipped.length} skipped`);
    if (result.failed.length) parts.push(`${result.failed.length} failed`);

    statusEl.textContent = parts.length ? `Import complete — ${parts.join(', ')}` : 'Nothing imported';
    showToast(parts.length ? `Import complete — ${parts.join(', ')}` : 'Nothing imported', result.failed.length ? 'error' : 'success');

    if (result.failed.length) {
      result.failed.forEach((f) => showToast(`${f.name}: ${f.error}`, 'error', 6000));
    }

    await renderLibrary(container, { onOpenBook, onOpenSettings });
  });

  container.querySelectorAll('[data-book-id]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.book-menu-btn')) return;
      const id = el.getAttribute('data-book-id');
      const book = filtered.find((b) => b.id === id);
      if (book) onOpenBook(book);
    });
  });

  container.querySelectorAll('.book-menu-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-book-id');
      const book = filtered.find((b) => b.id === id);
      if (!book) return;

      const menu = btn.nextElementSibling;
      const open = menu?.classList.contains('book-menu--open');
      container.querySelectorAll('.book-menu--open').forEach((m) => m.classList.remove('book-menu--open'));
      if (!open) menu?.classList.add('book-menu--open');
    });
  });

  container.querySelectorAll('[data-delete-id]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-delete-id');
      if (!id) return;
      if (!confirm('Remove this book from your library?')) return;
      await clearBookCache(id);
      revokeFallbackCoverUrl(id);
      await deleteBook(id);
      showToast('Book removed', 'info');
      await renderLibrary(container, { onOpenBook, onOpenSettings });
    });
  });

  document.addEventListener('click', closeMenusOnOutsideClick, { once: true });

  if (continueBook) {
    container.querySelector('[data-continue-id]')?.addEventListener('click', () => {
      onOpenBook(continueBook);
    });
  }

  container.querySelectorAll('[data-recent-id]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-recent-id');
      const book = books.find((b) => b.id === id);
      if (book) onOpenBook(book);
    });
  });
}

function closeMenusOnOutsideClick(e) {
  if (!(e.target instanceof Element) || !e.target.closest('.book-card-menu')) {
    document.querySelectorAll('.book-menu--open').forEach((m) => m.classList.remove('book-menu--open'));
  }
}

/**
 * @param {'all'|'epub'|'mp3'} filter
 * @param {string} label
 * @param {'all'|'epub'|'mp3'} active
 */
function renderFilterTab(filter, label, active) {
  const selected = filter === active;
  return `<button class="filter-tab ${selected ? 'filter-tab--active' : ''}" data-filter="${filter}" role="tab" aria-selected="${selected}">${label}</button>`;
}

/**
 * @param {Book[]} books
 * @param {'all'|'epub'|'mp3'} filter
 */
function filterBooks(books, filter) {
  if (filter === 'all') return books;
  return books.filter((b) => b.type === filter);
}

/**
 * @param {Book} book
 */
function renderContinueRow(book) {
  const percent = book.progress?.percent ?? 0;

  return `
    <section class="continue-section">
      <h2 class="section-heading">Continue Listening</h2>
      <button class="continue-card" data-continue-id="${book.id}" type="button">
        <div class="cover-wrap cover-wrap--sm">
          ${renderCoverMarkup(book)}
        </div>
        <div class="continue-info">
          <p class="continue-title">${escapeHtml(book.title)}</p>
          <p class="continue-author">${escapeHtml(book.author)}</p>
          <div class="progress-bar-track">
            <div class="progress-bar-fill" style="width: ${percent}%"></div>
          </div>
          <span class="progress-label">${percent}% complete</span>
        </div>
      </button>
    </section>
  `;
}

/**
 * @param {Book[]} books
 */
function renderRecentShelf(books) {
  return `
    <section class="recent-section">
      <h2 class="section-heading">Recently Added</h2>
      <div class="recent-scroll">
        ${books.map((book) => `
          <button class="recent-card" data-recent-id="${book.id}" type="button">
            <div class="cover-wrap cover-wrap--recent">
              ${renderCoverMarkup(book)}
            </div>
            <p class="recent-title">${escapeHtml(book.title)}</p>
          </button>
        `).join('')}
      </div>
    </section>
  `;
}

/**
 * @param {Book[]} books
 */
function renderBookGrid(books) {
  return `
    <div class="book-grid">
      ${books.map((book) => renderBookCard(book)).join('')}
    </div>
  `;
}

/**
 * @param {Book} book
 */
function renderBookCard(book) {
  const badge = book.type === 'mp3' ? 'MP3' : 'EPUB';

  return `
    <div class="book-card-wrap">
      <button class="book-card" data-book-id="${book.id}" type="button">
        <div class="cover-wrap">
          ${renderCoverMarkup(book)}
          <span class="format-badge">${badge}</span>
        </div>
        <p class="book-title">${escapeHtml(book.title)}</p>
        <p class="book-author">${escapeHtml(book.author)}</p>
      </button>
      <div class="book-card-menu">
        <button class="book-menu-btn icon-btn-touch" data-book-id="${book.id}" type="button" aria-label="Book options">${icon('more')}</button>
        <div class="book-menu">
          <button type="button" data-delete-id="${book.id}">${icon('trash', 18)} Remove</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * @param {'all'|'epub'|'mp3'} filter
 */
function renderEmptyState(filter) {
  const typeHint = filter === 'epub' ? 'EPUB' : filter === 'mp3' ? 'MP3' : 'MP3 or EPUB';
  return `
    <div class="empty-state">
      <p>No ${filter === 'all' ? 'books' : filter.toUpperCase() + ' books'} yet.</p>
      <p class="empty-hint">Tap <strong>Add Books</strong>, then in the Files app choose <strong>On My iPhone</strong> and select ${typeHint} files. You can select multiple EPUBs at once.</p>
    </div>
  `;
}

/**
 * @param {HTMLElement} container
 * @param {Book[]} books
 */
function patchCoversInDom(container, books) {
  const seen = new Set();
  for (const book of books) {
    if (seen.has(book.id)) continue;
    seen.add(book.id);
    const url = getBookCoverUrl(book);
    if (!url) continue;

    const wraps = container.querySelectorAll(
      `[data-book-id="${book.id}"] .cover-wrap, [data-continue-id="${book.id}"] .cover-wrap, [data-recent-id="${book.id}"] .cover-wrap`,
    );
    wraps.forEach((wrap) => {
      if (wrap.querySelector('img')) return;
      const badge = wrap.querySelector('.format-badge');
      wrap.innerHTML = `<img src="${url}" alt="" class="cover-img">${badge ? badge.outerHTML : ''}`;
    });
  }
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
