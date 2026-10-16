import { describe, it, expect, beforeEach, vi } from 'vitest';
import { maybeShowWelcome, openWelcome } from '../js/views/welcome.js';


beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<button id="opener">Menu</button>';
});

const sheet = () => document.querySelector('.welcome-sheet');

describe('welcome screen', () => {
  it('shows on first launch and not again once dismissed', () => {
    maybeShowWelcome();
    expect(sheet()).not.toBeNull();
    expect(localStorage.getItem('welcome-seen')).toBeNull();
    sheet().querySelector('[data-action="start"]').click();
    expect(sheet()).toBeNull();
    expect(localStorage.getItem('welcome-seen')).toBe('1');
    maybeShowWelcome();
    expect(sheet()).toBeNull();
  });

  it('counts Escape as dismissing it', () => {
    maybeShowWelcome();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(sheet()).toBeNull();
    expect(localStorage.getItem('welcome-seen')).toBe('1');
  });

  it('can be reopened on demand, with focus returning to the opener', () => {
    localStorage.setItem('welcome-seen', '1');
    const opener = document.getElementById('opener');
    openWelcome({ opener });
    expect(sheet()).not.toBeNull();
    sheet().querySelector('[data-action="start"]').click();
    expect(document.activeElement).toBe(opener);
  });

  it('opens LibriVox links in a new tab with noopener', () => {
    openWelcome({ opener: null });
    const links = [...sheet().querySelectorAll('a[href^="https://librivox.org"]')];
    expect(links.length).toBe(2);
    for (const a of links) {
      expect(a.target).toBe('_blank');
      expect(a.rel).toContain('noopener');
    }
  });

  it('offers Add books only when the library import input exists, and reuses it', () => {
    openWelcome({ opener: null });
    expect(sheet().querySelector('[data-action="add"]')).toBeNull();
    sheet().querySelector('[data-action="start"]').click();

    document.body.insertAdjacentHTML('beforeend', '<input type="file" id="import-input">');
    const click = vi.spyOn(document.getElementById('import-input'), 'click');
    openWelcome({ opener: null });
    sheet().querySelector('[data-action="add"]').click();
    expect(click).toHaveBeenCalledOnce();
    expect(sheet()).toBeNull();
  });

  it('falls back to once per session when localStorage throws', async () => {
    vi.resetModules();
    const fresh = await import('../js/views/welcome.js');
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    fresh.maybeShowWelcome();
    expect(sheet()).not.toBeNull();
    sheet().querySelector('[data-action="start"]').click();
    fresh.maybeShowWelcome();
    expect(sheet()).toBeNull();
    get.mockRestore();
    set.mockRestore();
  });
});
