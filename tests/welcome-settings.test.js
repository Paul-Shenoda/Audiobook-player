import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderSettings } from '../js/views/settings.js';

beforeEach(() => {
  localStorage.clear();
  globalThis.speechSynthesis = { getVoices: () => [], cancel() {}, speak() {} };
  document.body.innerHTML = '<div id="app"></div>';
});

describe('Settings welcome entry', () => {
  it('reopens the welcome screen', async () => {
    await renderSettings(document.getElementById('app'), { onBack() {} });
    expect(document.querySelector('.welcome-sheet')).toBeNull();
    document.getElementById('welcome-btn').click();
    expect(document.querySelector('.welcome-sheet')).not.toBeNull();
    expect(document.querySelector('.welcome-sheet h2').textContent).toMatch(/welcome/i);
  });
});
