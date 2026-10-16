import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { addBook, getBook } from '../js/storage/library-db.js';
import { createShelf, listShelves } from '../js/storage/shelves.js';
import { openBookShelvesSheet, openShelfNameSheet } from '../js/views/shelf-sheets.js';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<button id="opener">Menu</button>';
});

async function setup() {
  const one = createShelf('One');
  const two = createShelf('Two');
  const book = await addBook({ type: 'mp3', title: 'Dune', author: 'FH', tracks: [], shelves: [two.id] });
  return { one, two, book };
}

describe('book shelves sheet', () => {
  it('lists a labelled checkbox per shelf, ticked for the shelves the book is on', async () => {
    const { one, two, book } = await setup();
    openBookShelvesSheet({ book, opener: document.getElementById('opener') });
    const boxes = [...document.querySelectorAll('input[type=checkbox]')];
    expect(boxes.map((b) => b.value)).toEqual([one.id, two.id]);
    expect(boxes.map((b) => b.checked)).toEqual([false, true]);
    expect(document.querySelector(`label[for="${boxes[0].id}"]`).textContent).toBe('One');
  });

  it('saves a toggle to the book straight away and reports a change on close', async () => {
    const { one, two, book } = await setup();
    const onClose = vi.fn();
    openBookShelvesSheet({ book, opener: document.getElementById('opener'), onClose });
    const [first, second] = document.querySelectorAll('input[type=checkbox]');
    first.click();
    await vi.waitFor(async () => expect((await getBook(book.id)).shelves).toEqual([two.id, one.id]));
    second.click();
    await vi.waitFor(async () => expect((await getBook(book.id)).shelves).toEqual([one.id]));
    document.querySelector('.shelf-done').click();
    expect(onClose).toHaveBeenCalledWith(true);
    expect(document.querySelector('.shelf-sheet')).toBeNull();
  });

  it('does not report a change when nothing was toggled', async () => {
    const { book } = await setup();
    const onClose = vi.fn();
    openBookShelvesSheet({ book, opener: document.getElementById('opener'), onClose });
    document.querySelector('.ns-icon-btn').click();
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it('creates a new shelf inline, ticks it and saves it on the book', async () => {
    const { book } = await setup();
    openBookShelvesSheet({ book, opener: document.getElementById('opener') });
    const input = document.querySelector('#shelf-new-name');
    input.value = 'Road trip';
    document.querySelector('[data-role=new-form]').requestSubmit();
    await vi.waitFor(() => expect(listShelves().map((s) => s.name)).toContain('Road trip'));
    const created = listShelves().find((s) => s.name === 'Road trip');
    await vi.waitFor(async () => expect((await getBook(book.id)).shelves).toContain(created.id));
    const box = document.querySelector(`input[value="${created.id}"]`);
    expect(box.checked).toBe(true);
    expect(input.value).toBe('');
  });

  it('shows an error for a duplicate name and creates nothing', async () => {
    const { book } = await setup();
    openBookShelvesSheet({ book, opener: document.getElementById('opener') });
    document.querySelector('#shelf-new-name').value = 'one';
    document.querySelector('[data-role=new-form]').requestSubmit();
    await vi.waitFor(() => expect(document.querySelector('#shelf-new-error').textContent).toMatch(/already/i));
    expect(listShelves()).toHaveLength(2);
  });
});

describe('shelf name sheet', () => {
  it('has a labelled input, submits the name and closes', async () => {
    const onSubmit = vi.fn();
    openShelfNameSheet({ title: 'New shelf', submitLabel: 'Create', onSubmit, opener: document.getElementById('opener') });
    const input = document.querySelector('#shelf-name');
    expect(document.querySelector('label[for="shelf-name"]')).not.toBeNull();
    input.value = 'Bedtime';
    document.querySelector('.shelf-name-form').requestSubmit();
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Bedtime'));
    await vi.waitFor(() => expect(document.querySelector('.shelf-sheet')).toBeNull());
  });

  it('keeps the sheet open and shows the error when submit throws', async () => {
    const onSubmit = vi.fn(() => { throw new Error('Enter a shelf name.'); });
    openShelfNameSheet({ title: 'New shelf', submitLabel: 'Create', onSubmit, opener: document.getElementById('opener') });
    document.querySelector('.shelf-name-form').requestSubmit();
    await vi.waitFor(() => expect(document.querySelector('#shelf-name-error').textContent).toBe('Enter a shelf name.'));
    expect(document.querySelector('.shelf-sheet')).not.toBeNull();
  });
});
