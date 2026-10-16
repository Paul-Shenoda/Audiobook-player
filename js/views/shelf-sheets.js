import { openSheet } from '../utils/sheet.js';
import { icon } from '../utils/icons.js';
import { escapeHtml } from '../utils/escape-html.js';
import { listShelves, createShelf, setBookShelves } from '../storage/shelves.js';

/**
 * Bottom sheet with one checkbox per shelf for a single book, plus a field to
 * make a new shelf. Every change is saved straight away.
 *
 * @param {{
 *   book: { id: string, title: string, shelves?: string[] },
 *   opener?: Element|null,
 *   onClose?: (changed: boolean) => void,
 * }} options
 * @returns {{ close: () => void }}
 */
export function openBookShelvesSheet({ book, opener = document.activeElement, onClose }) {
  const selected = new Set(book.shelves ?? []);
  let changed = false;

  const sheet = openSheet({
    label: `Shelves for ${book.title}`,
    className: 'shelf-sheet',
    opener,
    onClose: () => onClose?.(changed),
  });
  const { panel } = sheet;

  panel.innerHTML = `
    <div class="ns-grab" aria-hidden="true"></div>
    <div class="ns-sheet-head">
      <h2 class="ns-sheet-title">Shelves</h2>
      <button type="button" class="ns-icon-btn" data-action="close" aria-label="Close">${icon('close', 22)}</button>
    </div>
    <p class="shelf-sheet-book">${escapeHtml(book.title)}</p>
    <form class="shelf-sheet-body" data-role="shelf-list" aria-label="Shelves for this book"></form>
    <form class="shelf-new" data-role="new-form">
      <label class="shelf-new-label" for="shelf-new-name">New shelf</label>
      <div class="shelf-new-row">
        <input id="shelf-new-name" class="shelf-input" type="text" name="name" autocomplete="off" maxlength="40" aria-describedby="shelf-new-error">
        <button type="submit" class="primary-btn shelf-new-btn">Add</button>
      </div>
      <p class="shelf-error" id="shelf-new-error" role="alert"></p>
    </form>
    <button type="button" class="primary-btn shelf-done" data-action="close">Done</button>
  `;

  const list = panel.querySelector('[data-role="shelf-list"]');
  const newForm = panel.querySelector('[data-role="new-form"]');
  const nameInput = panel.querySelector('#shelf-new-name');
  const errorEl = panel.querySelector('#shelf-new-error');

  function renderList() {
    const shelves = listShelves();
    list.innerHTML = shelves.length
      ? shelves
        .map(
          (s) => `
        <div class="shelf-check">
          <input type="checkbox" id="shelf-${escapeHtml(s.id)}" value="${escapeHtml(s.id)}" ${selected.has(s.id) ? 'checked' : ''}>
          <label for="shelf-${escapeHtml(s.id)}">${escapeHtml(s.name)}</label>
        </div>`,
        )
        .join('')
      : '<p class="shelf-sheet-empty">No shelves yet. Add one below.</p>';
  }

  /** Save the current choice. Resolves once the book record is written. */
  function save() {
    changed = true;
    return setBookShelves(book.id, [...selected]);
  }

  list.addEventListener('change', (e) => {
    const box = e.target;
    if (!(box instanceof HTMLInputElement)) return;
    if (box.checked) selected.add(box.value);
    else selected.delete(box.value);
    save();
  });
  list.addEventListener('submit', (e) => e.preventDefault());

  newForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const shelf = createShelf(nameInput.value);
      selected.add(shelf.id);
      errorEl.textContent = '';
      nameInput.value = '';
      renderList();
      await save();
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : String(err);
      nameInput.focus();
    }
  });

  panel.querySelectorAll('[data-action="close"]').forEach((b) => b.addEventListener('click', () => sheet.close()));

  renderList();
  sheet.focus();
  return { close: sheet.close };
}

/**
 * Small sheet with one labelled text field, for naming or renaming a shelf.
 * `onSubmit` gets the typed name; if it throws, the message is shown under the
 * field and the sheet stays open.
 *
 * @param {{
 *   title: string,
 *   submitLabel: string,
 *   initial?: string,
 *   opener?: Element|null,
 *   onSubmit: (name: string) => void|Promise<void>,
 * }} options
 * @returns {{ close: () => void }}
 */
export function openShelfNameSheet({ title, submitLabel, initial = '', opener = document.activeElement, onSubmit }) {
  const sheet = openSheet({ label: title, className: 'shelf-sheet', opener });
  const { panel } = sheet;

  panel.innerHTML = `
    <div class="ns-grab" aria-hidden="true"></div>
    <div class="ns-sheet-head">
      <h2 class="ns-sheet-title">${escapeHtml(title)}</h2>
      <button type="button" class="ns-icon-btn" data-action="close" aria-label="Close">${icon('close', 22)}</button>
    </div>
    <form class="shelf-name-form" novalidate>
      <label class="shelf-new-label" for="shelf-name">Shelf name</label>
      <input id="shelf-name" class="shelf-input" type="text" name="name" autocomplete="off" maxlength="40" value="${escapeHtml(initial)}" aria-describedby="shelf-name-error">
      <p class="shelf-error" id="shelf-name-error" role="alert"></p>
      <button type="submit" class="primary-btn shelf-done">${escapeHtml(submitLabel)}</button>
    </form>
  `;

  const form = panel.querySelector('form');
  const input = panel.querySelector('#shelf-name');
  const errorEl = panel.querySelector('#shelf-name-error');

  panel.querySelector('[data-action="close"]').addEventListener('click', () => sheet.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await onSubmit(input.value);
      sheet.close();
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : String(err);
      input.focus();
    }
  });

  sheet.focus(input);
  input.select();
  return { close: sheet.close };
}
