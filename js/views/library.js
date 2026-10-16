import {
  getAllBooks,
  deleteBook,
  updateBook,
} from '../storage/library-db.js';
import { importBooks, importCombinedAudiobook, naturalSortFiles } from '../services/import-service.js';
import { requestPersistentStorage } from '../utils/storage-persist.js';
import { clearBookCache } from '../tts/chunk-cache.js';
import { showToast } from '../utils/toast.js';
import { isIOS } from '../utils/platform.js';
import { filterBooks, searchBooks, sortBooks, pickContinueBook, bookStatus } from '../utils/book-filters.js';
import { icon } from '../utils/icons.js';
import {
  renderCoverMarkup,
  hydrateCoverUrls,
  revokeFallbackCoverUrl,
  getBookCoverUrl,
  getFormatBadge,
} from '../utils/cover-art.js';
import { seriesLabel } from '../utils/series-label.js';

/**
 * @typedef {import('../storage/library-db.js').Book} Book
 */

/** @type {'all'|'epub'|'mp3'|'finished'} */
let activeFilter = 'all';

/** @type {string} */
let searchQuery = '';

const VIEW_KEY = 'library-view';
/** Phone layout: rows or covers. From 1024px the grid is always used. @type {'list'|'grid'} */
let viewMode = localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list';

const GRID_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg>';

const SORT_KEY = 'library-sort';
/** @type {'recent'|'title'|'author'} */
let sortBy = /** @type {any} */ (localStorage.getItem(SORT_KEY)) || 'recent';

/**
 * @param {HTMLElement} container
 * @param {{ onOpenBook: (book: Book) => void, onOpenSettings: () => void }} callbacks
 */
export async function renderLibrary(container, { onOpenBook, onOpenSettings }) {
  const books = await getAllBooks();
  const continueBook = pickContinueBook(books);
  container.innerHTML = `
    <div class="library-view">
      <nav class="library-sidebar" aria-label="Library navigation">
        <div class="sidebar-brand">${icon('library', 28)}<span>My Library</span></div>
        <ul class="sidebar-nav">
          <li><button class="sidebar-link sidebar-link--current" type="button" aria-current="page">${icon('library', 20)} Library</button></li>
          <li><button class="sidebar-link" id="sidebar-settings" type="button">${icon('settings', 20)} Settings</button></li>
        </ul>
        <button class="sidebar-add primary-btn" id="sidebar-add" type="button">${icon('add', 20)} Add books</button>
        <button class="sidebar-link sidebar-combine" id="sidebar-combine" type="button">${icon('layers', 20)} Combine files</button>
        <p class="sidebar-note">MP3, M4B, M4A and EPUB. Files stay in this browser.</p>
      </nav>

      <div class="library-main">
        <header class="library-header">
          <h1 class="library-title">Library</h1>
          <div class="header-actions">
            <button class="round-btn" id="search-toggle" type="button" aria-label="Search library" aria-expanded="${searchQuery ? 'true' : 'false'}">${icon('search', 20)}</button>
            <button class="round-btn header-extra" id="settings-btn" type="button" aria-label="Settings">${icon('settings', 20)}</button>
            <button class="round-btn header-extra" id="combine-btn" type="button" aria-label="Combine chapter files into one audiobook">${icon('layers', 20)}</button>
            <input type="file" id="combine-input" accept=".mp3,.m4b,.m4a,.mp4,audio/mpeg,audio/mp4,audio/x-m4a,audio/x-m4b,video/mp4" multiple class="visually-hidden">
            <label class="round-btn round-btn--accent import-btn" title="Add books">
              ${icon('add', 22)}<span class="visually-hidden">Add books</span>
              <input type="file" id="import-input" accept=".mp3,.m4b,.m4a,.mp4,audio/mpeg,audio/mp4,audio/x-m4a,audio/x-m4b,video/mp4,.epub,application/epub+zip" multiple class="visually-hidden">
            </label>
          </div>
        </header>

        <div class="search-box ${searchQuery ? 'search-box--open' : ''}" id="search-box">
          ${icon('search', 18)}
          <input type="search" id="search-input" placeholder="Search title or author" value="${escapeAttr(searchQuery)}" aria-label="Search library">
        </div>

        <p class="import-hint">On iPhone: Files → On My iPhone → select one or more EPUBs. Multiple chapter files for the same book? Use the combine icon (${icon('layers', 14)}) instead.</p>

        <div id="import-status" class="import-status" hidden></div>

        ${continueBook ? renderContinueRow(continueBook) : ''}

        <section class="library-section">
          <div class="library-controls">
            <div class="filter-tabs" role="tablist" aria-label="Filter books">
              ${renderFilterTab('all', 'All', activeFilter)}
              ${renderFilterTab('epub', 'EPUB', activeFilter)}
              ${renderFilterTab('mp3', 'Audio', activeFilter)}
              ${renderFilterTab('finished', 'Finished', activeFilter)}
            </div>
            <div class="library-toolbar">
              <label class="sort-wrap">${icon('sort', 18)}
                <select id="sort-select" aria-label="Sort library">
                  <option value="recent" ${sortBy === 'recent' ? 'selected' : ''}>Recent</option>
                  <option value="title" ${sortBy === 'title' ? 'selected' : ''}>Title</option>
                  <option value="author" ${sortBy === 'author' ? 'selected' : ''}>Author</option>
                </select>
              </label>
              <button class="round-btn view-toggle" id="view-toggle" type="button" aria-label="${viewMode === 'grid' ? 'Show as list' : 'Show as grid'}">${viewMode === 'grid' ? icon('list', 18) : GRID_ICON}</button>
            </div>
          </div>
          <div id="library-books" class="library-books" data-view="${viewMode}"></div>
        </section>

        ${isIOS() ? '<p class="storage-notice">Books are stored in this browser. Safari may free space if storage is low.</p>' : ''}
      </div>
    </div>
  `;

  const booksArea = container.querySelector('#library-books');

  async function renderBooksArea() {
    const visible = sortBooks(
      searchBooks(filterBooks(books, activeFilter), searchQuery),
      sortBy,
    );
    booksArea.innerHTML = visible.length
      ? renderBookGrid(visible)
      : renderEmptyState(activeFilter, searchQuery);

    await hydrateCoverUrls(visible);
    patchCoversInDom(booksArea, visible);

    booksArea.querySelectorAll('[data-book-id]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.book-menu-btn')) return;
        const id = el.getAttribute('data-book-id');
        const book = visible.find((b) => b.id === id);
        if (book) onOpenBook(book);
      });
    });

    booksArea.querySelectorAll('.book-menu-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = btn.nextElementSibling;
        const open = menu?.classList.contains('book-menu--open');
        container.querySelectorAll('.book-menu--open').forEach((m) => m.classList.remove('book-menu--open'));
        if (!open) menu?.classList.add('book-menu--open');
      });
    });

    booksArea.querySelectorAll('[data-edit-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-edit-id');
        const book = visible.find((b) => b.id === id);
        if (!book) return;
        openEditDetailsModal(book, async () => {
          await renderLibrary(container, { onOpenBook, onOpenSettings });
        });
      });
    });

    booksArea.querySelectorAll('[data-finish-id]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-finish-id');
        const book = visible.find((b) => b.id === id);
        if (!book) return;
        await updateBook(id, { finishedAt: book.finishedAt ? null : Date.now() });
        showToast(book.finishedAt ? 'Marked as unfinished' : 'Marked as finished', 'info');
        await renderLibrary(container, { onOpenBook, onOpenSettings });
      });
    });

    booksArea.querySelectorAll('[data-delete-id]').forEach((btn) => {
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
  }

  await renderBooksArea();
  if (continueBook) {
    await hydrateCoverUrls([continueBook]);
    patchCoversInDom(container, [continueBook]);
  }

  container.querySelector('#settings-btn').addEventListener('click', onOpenSettings);
  container.querySelector('#sidebar-settings').addEventListener('click', onOpenSettings);
  container.querySelector('#sidebar-add').addEventListener('click', () => {
    container.querySelector('#import-input').click();
  });
  container.querySelector('#sidebar-combine').addEventListener('click', () => {
    container.querySelector('#combine-input').click();
  });

  const searchBox = container.querySelector('#search-box');
  const searchToggle = container.querySelector('#search-toggle');
  searchToggle.addEventListener('click', () => {
    const open = !searchBox.classList.contains('search-box--open');
    searchBox.classList.toggle('search-box--open', open);
    searchToggle.setAttribute('aria-expanded', String(open));
    if (open) container.querySelector('#search-input').focus();
  });

  container.querySelector('#view-toggle').addEventListener('click', () => {
    viewMode = viewMode === 'grid' ? 'list' : 'grid';
    localStorage.setItem(VIEW_KEY, viewMode);
    booksArea.setAttribute('data-view', viewMode);
    const toggle = container.querySelector('#view-toggle');
    toggle.setAttribute('aria-label', viewMode === 'grid' ? 'Show as list' : 'Show as grid');
    toggle.innerHTML = viewMode === 'grid' ? icon('list', 18) : GRID_ICON;
  });

  container.querySelector('#search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderBooksArea();
  });

  container.querySelector('#sort-select').addEventListener('change', (e) => {
    sortBy = e.target.value;
    localStorage.setItem(SORT_KEY, sortBy);
    renderBooksArea();
  });

  container.querySelectorAll('.filter-tab').forEach((tab) => {
    tab.addEventListener('click', async () => {
      activeFilter = tab.getAttribute('data-filter') ?? 'all';
      await renderLibrary(container, { onOpenBook, onOpenSettings });
    });
  });

  container.querySelector('#combine-btn').addEventListener('click', () => {
    container.querySelector('#combine-input').click();
  });

  container.querySelector('#combine-input').addEventListener('change', (event) => {
    const input = event.target;
    const files = naturalSortFiles(Array.from(input.files ?? []));
    input.value = '';
    if (files.length < 2) {
      showToast('Select two or more chapter files to combine', 'error');
      return;
    }
    openCombinePreviewModal(files, async () => {
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

    let result;
    try {
      result = await importBooks(files, (current, total, name) => {
        statusEl.textContent = `Importing ${current} of ${total}: ${name}`;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      statusEl.textContent = `Import failed: ${msg}`;
      showToast(`Import failed: ${msg}`, 'error', 6000);
      input.value = '';
      return;
    }

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

    if (result.added.length) {
      // Ask the browser to protect the library from storage eviction.
      requestPersistentStorage();
    }

    await renderLibrary(container, { onOpenBook, onOpenSettings });
  });

  document.addEventListener('click', closeMenusOnOutsideClick, { once: true });

  if (continueBook) {
    container.querySelector('[data-continue-id]')?.addEventListener('click', () => {
      onOpenBook(continueBook);
    });
  }
}

/**
 * @param {Book} book
 * @param {() => void} onSaved
 */
function openEditDetailsModal(book, onSaved) {
  document.querySelector('.edit-sheet')?.remove();

  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet chapter-sheet';
  sheet.innerHTML = `
    <div class="chapter-sheet-panel edit-sheet-panel">
      <div class="chapter-sheet-header">
        <h3>Edit details</h3>
        <button class="icon-btn-touch" id="edit-sheet-close" type="button" aria-label="Close">${icon('close')}</button>
      </div>
      <form class="edit-form" id="edit-form">
        <label class="edit-field">
          <span>Title</span>
          <input type="text" name="title" value="${escapeAttr(book.title)}" required>
        </label>
        <label class="edit-field">
          <span>Author</span>
          <input type="text" name="author" value="${escapeAttr(book.author)}" required>
        </label>
        <label class="edit-field">
          <span>Series name</span>
          <input type="text" name="seriesName" value="${escapeAttr(book.series?.name ?? '')}" placeholder="e.g. The Stormlight Archive">
        </label>
        <label class="edit-field">
          <span>Book number</span>
          <input type="number" name="seriesPosition" value="${book.series?.position ?? ''}" step="0.5" min="0" placeholder="e.g. 2">
        </label>
        <button type="submit" class="primary-btn edit-save-btn">Save</button>
      </form>
    </div>
  `;
  document.body.appendChild(sheet);

  function close() {
    sheet.classList.add('chapter-sheet--closing');
    sheet.addEventListener('transitionend', () => sheet.remove(), { once: true });
  }

  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) close();
  });
  sheet.querySelector('#edit-sheet-close').addEventListener('click', close);

  sheet.querySelector('#edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const title = String(data.get('title') ?? '').trim();
    const author = String(data.get('author') ?? '').trim();
    const seriesName = String(data.get('seriesName') ?? '').trim();
    const seriesPositionRaw = String(data.get('seriesPosition') ?? '').trim();
    const series = seriesName
      ? { name: seriesName, ...(seriesPositionRaw ? { position: Number(seriesPositionRaw) } : {}) }
      : null;

    await updateBook(book.id, { title, author, series });
    close();
    onSaved();
  });
}

/**
 * @param {File[]} files natural-sorted order to start from
 * @param {() => void} onImported
 */
function openCombinePreviewModal(files, onImported) {
  document.querySelector('.combine-sheet')?.remove();
  let order = [...files];

  const sheet = document.createElement('div');
  sheet.className = 'combine-sheet chapter-sheet';
  document.body.appendChild(sheet);

  function render() {
    sheet.innerHTML = `
      <div class="chapter-sheet-panel edit-sheet-panel">
        <div class="chapter-sheet-header">
          <h3>Combine ${order.length} files into one audiobook</h3>
          <button class="icon-btn-touch" id="combine-sheet-close" type="button" aria-label="Close">${icon('close')}</button>
        </div>
        <form class="edit-form" id="combine-form">
          <label class="edit-field">
            <span>Title</span>
            <input type="text" name="title" placeholder="${escapeAttr(order[0].name.replace(/\.[^.]+$/, ''))}">
          </label>
          <label class="edit-field">
            <span>Author</span>
            <input type="text" name="author" placeholder="Unknown Artist">
          </label>
          <div class="combine-file-list">
            ${order
              .map(
                (f, i) => `
                <div class="combine-file-row">
                  <span class="combine-file-index">${i + 1}</span>
                  <span class="combine-file-name">${escapeHtml(f.name)}</span>
                  <button type="button" class="icon-btn-touch" data-move-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('chevronUp', 18)}</button>
                  <button type="button" class="icon-btn-touch" data-move-down="${i}" ${i === order.length - 1 ? 'disabled' : ''} aria-label="Move down">${icon('chevronDown', 18)}</button>
                </div>
              `,
              )
              .join('')}
          </div>
          <button type="submit" class="primary-btn edit-save-btn">Combine into one audiobook</button>
        </form>
      </div>
    `;

    sheet.querySelector('#combine-sheet-close').addEventListener('click', close);
    sheet.querySelectorAll('[data-move-up]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.getAttribute('data-move-up'));
        [order[i - 1], order[i]] = [order[i], order[i - 1]];
        render();
      });
    });
    sheet.querySelectorAll('[data-move-down]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.getAttribute('data-move-down'));
        [order[i], order[i + 1]] = [order[i + 1], order[i]];
        render();
      });
    });
    sheet.querySelector('#combine-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      const title = String(data.get('title') ?? '').trim();
      const author = String(data.get('author') ?? '').trim();
      const submitBtn = sheet.querySelector('.edit-save-btn');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Combining…';
      try {
        await importCombinedAudiobook(order, {
          ...(title ? { title } : {}),
          ...(author ? { author } : {}),
        });
        showToast('Combined audiobook added', 'success');
        close();
        onImported();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Combine failed: ${msg}`, 'error', 6000);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Combine into one audiobook';
      }
    });
  }

  function close() {
    sheet.classList.add('chapter-sheet--closing');
    sheet.addEventListener('transitionend', () => sheet.remove(), { once: true });
  }

  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) close();
  });

  render();
}

function closeMenusOnOutsideClick(e) {
  if (!(e.target instanceof Element) || !e.target.closest('.book-card-menu')) {
    document.querySelectorAll('.book-menu--open').forEach((m) => m.classList.remove('book-menu--open'));
  }
}

/**
 * @param {'all'|'epub'|'mp3'|'finished'} filter
 * @param {string} label
 * @param {'all'|'epub'|'mp3'|'finished'} active
 */
function renderFilterTab(filter, label, active) {
  const selected = filter === active;
  return `<button class="filter-tab ${selected ? 'filter-tab--active' : ''}" data-filter="${filter}" role="tab" aria-selected="${selected}">${label}</button>`;
}


/**
 * @param {Book} book
 */
function renderContinueRow(book) {
  const { percent } = bookStatus(book);

  return `
    <section class="continue-section" aria-labelledby="continue-heading">
      <h2 class="section-heading" id="continue-heading">Continue listening</h2>
      <button class="continue-card" data-continue-id="${book.id}" type="button" aria-label="Continue ${escapeAttr(book.title)}">
        <div class="cover-wrap cover-wrap--sm">
          ${renderCoverMarkup(book)}
        </div>
        <div class="continue-info">
          <p class="continue-title">${escapeHtml(book.title)}</p>
          <p class="continue-author">${escapeHtml(book.author)}</p>
          ${book.series ? `<p class="book-series">${escapeHtml(seriesLabel(book.series))}</p>` : ''}
          <div class="progress-bar-track">
            <div class="progress-bar-fill" style="width: ${percent}%"></div>
          </div>
          <span class="progress-label">${percent}% complete</span>
        </div>
        <span class="continue-play" aria-hidden="true">${icon('play', 22)}</span>
      </button>
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
  const badge = getFormatBadge(book);
  const status = bookStatus(book);

  return `
    <div class="book-card-wrap">
      <button class="book-card" data-book-id="${book.id}" type="button">
        <div class="cover-wrap">
          ${renderCoverMarkup(book)}
          ${status.kind === 'progress' ? `<span class="cover-progress" aria-hidden="true"><span style="width: ${status.percent}%"></span></span>` : ''}
        </div>
        <div class="book-text">
          <p class="book-title">${escapeHtml(book.title)}</p>
          <p class="book-author">${escapeHtml(book.author)}</p>
          ${book.series ? `<p class="book-series">${escapeHtml(seriesLabel(book.series))}</p>` : ''}
          <p class="book-meta"><span class="type-chip">${badge}</span><span class="book-status book-status--${status.kind}">${status.label}</span></p>
        </div>
      </button>
      <div class="book-card-menu">
        <button class="book-menu-btn icon-btn-touch" data-book-id="${book.id}" type="button" aria-label="More options for ${escapeAttr(book.title)}" aria-haspopup="menu">${icon('more')}</button>
        <div class="book-menu" role="menu">
          <button type="button" role="menuitem" data-edit-id="${book.id}">${icon('edit', 18)} Edit details</button>
          <button type="button" role="menuitem" data-finish-id="${book.id}">${icon('check', 18)} ${book.finishedAt ? 'Mark unfinished' : 'Mark finished'}</button>
          <button type="button" role="menuitem" data-delete-id="${book.id}">${icon('trash', 18)} Remove</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * @param {'all'|'epub'|'mp3'|'finished'} filter
 * @param {string} [query]
 */
function renderEmptyState(filter, query = '') {
  if (query.trim()) {
    return `
      <div class="empty-state">
        <p>No matches for “${escapeHtml(query.trim())}”.</p>
      </div>
    `;
  }
  if (filter === 'finished') {
    return `
      <div class="empty-state">
        <p>No finished books yet.</p>
        <p class="empty-hint">Books land here when you finish them, or use the ··· menu on a book to mark it finished.</p>
      </div>
    `;
  }
  const label = filter === 'all' ? 'books' : filter === 'mp3' ? 'audio files' : 'EPUB books';
  const typeHint = filter === 'epub' ? 'EPUB' : filter === 'mp3' ? 'audio' : 'audio or EPUB';
  return `
    <div class="empty-state">
      <p>No ${label} yet.</p>
      <p class="empty-hint">Tap <strong>Add Books</strong>, then in the Files app choose <strong>On My iPhone</strong> and select ${typeHint} files. You can select multiple books at once.</p>
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
      `[data-book-id="${book.id}"] .cover-wrap, [data-continue-id="${book.id}"] .cover-wrap`,
    );
    wraps.forEach((wrap) => {
      if (wrap.querySelector('img')) return;
      const badge = wrap.querySelector('.format-badge');
      wrap.innerHTML = `<img src="${url}" alt="" class="cover-img">${badge ? badge.outerHTML : ''}`;
    });
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return escapeHtml(text).replace(/"/g, '&quot;');
}
