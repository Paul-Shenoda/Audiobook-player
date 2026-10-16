import { playerStore } from '../services/player-store.js';
import { addBookmark, removeBookmark, getBookmarks, describeNow, jumpToBookmark } from '../services/bookmarks.js';
import { openSheet } from '../utils/sheet.js';
import { icon } from '../utils/icons.js';
import { escapeHtml } from '../utils/escape-html.js';
import { formatTime } from '../utils/format-time.js';
import { unlockMediaForAutoplay } from '../utils/audio-unlock.js';
import { showToast } from '../utils/toast.js';

/**
 * Bottom sheet with a Chapters tab and a Bookmarks tab (Revised-Chapters artboard).
 * It reads the store and sends commands; it keeps no playback state of its own.
 *
 * @param {{
 *   opener?: Element|null,
 *   tab?: 'chapters'|'bookmarks',
 *   store?: typeof playerStore,
 *   onClose?: () => void,
 * }} [options]
 * @returns {{ close: () => void }}
 */
export function openChaptersSheet({ opener = document.activeElement, tab = 'chapters', store = playerStore, onClose } = {}) {
  const book = store.getState().book;
  let activeTab = tab;
  /** The chapter list the rows were last built from, to know when to rebuild. */
  let builtFor = null;
  let builtIndex = -1;

  const sheet = openSheet({
    label: book?.title ?? 'Chapters',
    className: 'cs-sheet',
    opener,
    onClose: () => {
      unsubscribe();
      onClose?.();
    },
  });
  const { panel } = sheet;

  panel.innerHTML = `
    <div class="ns-grab" aria-hidden="true"></div>
    <div class="ns-sheet-head">
      <h2 class="ns-sheet-title">${escapeHtml(book?.title ?? '')}</h2>
      <button type="button" class="ns-icon-btn" data-action="close" aria-label="Close">${icon('close', 22)}</button>
    </div>
    <div class="cs-tabs" role="tablist" aria-label="Chapters or bookmarks">
      <button type="button" role="tab" id="cs-tab-chapters" aria-controls="cs-body" data-tab="chapters">Chapters</button>
      <button type="button" role="tab" id="cs-tab-bookmarks" aria-controls="cs-body" data-tab="bookmarks">Bookmarks</button>
    </div>
    <div class="cs-body" id="cs-body" role="tabpanel"></div>
  `;
  const body = panel.querySelector('#cs-body');

  panel.querySelector('[data-action="close"]').addEventListener('click', () => sheet.close());
  panel.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
    btn.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const next = activeTab === 'chapters' ? 'bookmarks' : 'chapters';
      showTab(next);
      panel.querySelector(`[data-tab="${next}"]`).focus();
    });
  });

  function updateBookmarkCount() {
    panel.querySelector('[data-tab="bookmarks"]').textContent = `Bookmarks (${getBookmarks(book).length})`;
  }

  function showTab(next) {
    activeTab = next;
    panel.querySelectorAll('[data-tab]').forEach(btn => {
      const selected = btn.dataset.tab === activeTab;
      btn.setAttribute('aria-selected', String(selected));
      btn.tabIndex = selected ? 0 : -1;
    });
    body.setAttribute('aria-labelledby', `cs-tab-${activeTab}`);
    updateBookmarkCount();
    builtFor = null;
    if (activeTab === 'chapters') renderChapters(store.getState());
    else renderBookmarks();
  }

  // ---- Chapters ----

  function progressText(s) {
    return `${formatTime(s.chapterElapsed)} of ${formatTime(s.chapterDuration)}`;
  }

  function renderChapters(s) {
    const { chapters, chapterIndex } = s;
    if (builtFor === chapters && builtIndex === chapterIndex) {
      // Only the playing chapter's progress moves.
      const fill = body.querySelector('.cs-row-fill');
      if (fill) fill.style.width = `${percentOf(s)}%`;
      const text = body.querySelector('.cs-row-time');
      if (text) text.textContent = progressText(s);
      return;
    }
    const scrollTop = body.scrollTop;
    builtFor = chapters;
    builtIndex = chapterIndex;
    if (!chapters.length) {
      body.innerHTML = '<p class="cs-empty">This book has no chapters.</p>';
      return;
    }
    body.innerHTML = `<ol class="cs-list">${chapters
      .map((c, i) => {
        const current = i === chapterIndex;
        const done = i < chapterIndex;
        const title = c.title || `Chapter ${i + 1}`;
        return `
          <li>
            <button type="button" class="cs-row${current ? ' cs-row--current' : ''}" data-chapter="${i}" ${current ? 'aria-current="true"' : ''}>
              <span class="cs-num">${i + 1}</span>
              <span class="cs-main">
                <span class="cs-title${done ? ' cs-title--done' : ''}">${escapeHtml(title)}</span>
                ${current ? `<span class="cs-row-progress"><span class="cs-row-bar"><span class="cs-row-fill" style="width:${percentOf(s)}%"></span></span><span class="cs-row-time">${progressText(s)}</span></span>` : ''}
              </span>
              ${done ? `<span class="cs-played" role="img" aria-label="Played">${icon('check', 18)}</span>` : ''}
              <span class="cs-len">${c.duration != null ? formatTime(c.duration) : ''}</span>
            </button>
          </li>`;
      })
      .join('')}</ol>`;
    body.querySelectorAll('[data-chapter]').forEach(btn => {
      btn.addEventListener('click', () => {
        const index = Number(btn.dataset.chapter);
        if (index !== store.getState().chapterIndex) {
          unlockMediaForAutoplay();
          store.goToChapter(index);
        }
        sheet.close();
      });
    });
    body.scrollTop = scrollTop;
    if (!scrollTop) body.querySelector('.cs-row--current')?.scrollIntoView?.({ block: 'center' });
  }

  function percentOf(s) {
    return s.chapterDuration > 0 ? Math.min(100, Math.round((s.chapterElapsed / s.chapterDuration) * 100)) : 0;
  }

  // ---- Bookmarks ----

  function renderBookmarks() {
    const s = store.getState();
    const { time, chapterName } = describeNow(s);
    const list = getBookmarks(book);
    updateBookmarkCount();
    body.innerHTML = `
      <div class="cs-bookmarks">
        <button type="button" class="cs-add" data-action="add">${icon('plus', 18)}<span>Bookmark ${time} in ${escapeHtml(chapterName)}</span></button>
        ${list.length
          ? `<ul class="cs-bm-list">${list
              .map(
                bm => `
              <li class="cs-bm">
                <button type="button" class="cs-bm-play" data-jump="${bm.id}" aria-label="Play from ${escapeHtml(bm.label)}">${icon('play', 16)}</button>
                <p class="cs-bm-label">${escapeHtml(bm.label)}</p>
                <button type="button" class="ns-icon-btn cs-bm-remove" data-remove="${bm.id}" aria-label="Delete bookmark">${icon('trash', 18)}</button>
              </li>`,
              )
              .join('')}</ul>`
          : '<p class="cs-empty">No bookmarks yet.</p>'}
      </div>`;
    body.querySelector('[data-action="add"]').addEventListener('click', () => {
      addBookmark(book, store.getState());
      showToast('Bookmark added', 'success');
      renderBookmarks();
      body.querySelector('[data-action="add"]')?.focus();
    });
    body.querySelectorAll('[data-jump]').forEach(btn => {
      btn.addEventListener('click', () => {
        const bm = getBookmarks(book).find(b => b.id === btn.dataset.jump);
        if (!bm) return;
        unlockMediaForAutoplay();
        sheet.close();
        jumpToBookmark(store, bm);
      });
    });
    body.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        removeBookmark(book, btn.dataset.remove);
        renderBookmarks();
        body.querySelector('[data-action="add"]')?.focus();
      });
    });
  }

  // The chapters tab follows playback; the bookmarks tab only needs the time on its add button.
  const unsubscribe = store.subscribe(s => {
    if (s.book?.id !== book?.id) {
      sheet.close();
    } else if (activeTab === 'chapters') {
      renderChapters(s);
    }
  });

  showTab(activeTab);
  sheet.focus(panel.querySelector(`[data-tab="${activeTab}"]`));

  return { close: sheet.close };
}
