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
import { filterBooks, searchBooks, sortBooks } from '../utils/book-filters.js';
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

const SORT_KEY = 'library-sort';
/** @type {'recent'|'title'|'author'} */
let sortBy = /** @type {any} */ (localStorage.getItem(SORT_KEY)) || 'recent';

/**
 * @param {HTMLElement} container
 * @param {{ onOpenBook: (book: Book) => void, onOpenSettings: () => void }} callbacks
 */
export async function renderLibrary(container, { onOpenBook, onOpenSettings }) {
  const books = await getAllBooks();
  const continueBook = books.find((b) => !b.finishedAt) ?? null;
  const recentBooks = [...books]
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, 8);

  container.innerHTML = `
    <div class="library-view">
      <header class="library-header">
        <h1 class="library-title">My Library</h1>
        <div class="header-actions">
          <button class="icon-btn-touch" id="settings-btn" type="button" aria-label="Settings">${icon('settings')}</button>
          <button class="icon-btn-touch" id="combine-btn" type="button" aria-label="Combine chapter files into one audiobook">${icon('layers')}</button>
          <input type="file" id="combine-input" accept=".mp3,.m4b,.m4a,audio/mpeg,audio/mp4,audio/x-m4a,audio/x-m4b" multiple class="visually-hidden">
          <label class="import-btn primary-btn">
            ${icon('add', 20)} Add Books
            <input type="file" id="import-input" accept=".mp3,.m4b,.m4a,audio/mpeg,audio/mp4,audio/x-m4a,audio/x-m4b,.epub,application/epub+zip" multiple class="visually-hidden">
          </label>
        </div>
      </header>

      <p class="import-hint">On iPhone: Files → On My iPhone → select one or more EPUBs. Multiple chapter files for the same book? Use the combine icon (${icon('layers', 14)}) instead.</p>

      <div id="import-status" class="import-status" hidden></div>

      <div class="filter-tabs" role="tablist">
        ${renderFilterTab('all', 'All', activeFilter)}
        ${renderFilterTab('epub', 'EPUB', activeFilter)}
        ${renderFilterTab('mp3', 'Audio', activeFilter)}
        ${renderFilterTab('finished', 'Finished', activeFilter)}
      </div>

      <div class="library-toolbar">
        <div class="search-box">
          ${icon('search', 18)}
          <input type="search" id="search-input" placeholder="Search title or author" value="${escapeAttr(searchQuery)}" aria-label="Search library">
        </div>
        <select id="sort-select" aria-label="Sort library">
          <option value="recent" ${sortBy === 'recent' ? 'selected' : ''}>Recent</option>
          <option value="title" ${sortBy === 'title' ? 'selected' : ''}>Title</option>
          <option value="author" ${sortBy === 'author' ? 'selected' : ''}>Author</option>
        </select>
      </div>

      ${continueBook ? renderContinueRow(continueBook) : ''}

      ${recentBooks.length > 1 ? renderRecentShelf(recentBooks) : ''}

      <section class="library-section">
        <h2 class="section-heading">Your Library</h2>
        <div id="library-books"></div>
      </section>

      ${isIOS() ? '<p class="storage-notice">Books are stored in this browser. Safari may free space if storage is low.</p>' : ''}
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
  await hydrateCoverUrls([...(continueBook ? [continueBook] : []), ...recentBooks]);
  patchCoversInDom(container, [...(continueBook ? [continueBook] : []), ...recentBooks]);

  container.querySelector('#settings-btn').addEventListener('click', onOpenSettings);

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

  container.querySelectorAll('[data-recent-id]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-recent-id');
      const book = books.find((b) => b.id === id);
      if (book) onOpenBook(book);
    });
  });
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
          ${book.series ? `<p class="book-series">${escapeHtml(seriesLabel(book.series))}</p>` : ''}
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
  const badge = getFormatBadge(book);

  return `
    <div class="book-card-wrap">
      <button class="book-card" data-book-id="${book.id}" type="button">
        <div class="cover-wrap">
          ${renderCoverMarkup(book)}
          <span class="format-badge">${badge}</span>
        </div>
        <p class="book-title">${escapeHtml(book.title)}</p>
        <p class="book-author">${escapeHtml(book.author)}</p>
        ${book.series ? `<p class="book-series">${escapeHtml(seriesLabel(book.series))}</p>` : ''}
      </button>
      <div class="book-card-menu">
        <button class="book-menu-btn icon-btn-touch" data-book-id="${book.id}" type="button" aria-label="Book options">${icon('more')}</button>
        <div class="book-menu">
          <button type="button" data-edit-id="${book.id}">${icon('edit', 18)} Edit details</button>
          <button type="button" data-finish-id="${book.id}">${icon('check', 18)} ${book.finishedAt ? 'Mark unfinished' : 'Mark finished'}</button>
          <button type="button" data-delete-id="${book.id}">${icon('trash', 18)} Remove</button>
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
      `[data-book-id="${book.id}"] .cover-wrap, [data-continue-id="${book.id}"] .cover-wrap, [data-recent-id="${book.id}"] .cover-wrap`,
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
