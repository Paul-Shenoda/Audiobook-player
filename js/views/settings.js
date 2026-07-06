import { loadTTSSettings, saveTTSSettings, defaultSettings, TTSRouter } from '../tts/tts-router.js';
import { getStorageInfo, requestPersistentStorage, formatBytes } from '../utils/storage-persist.js';
import { clearBookCache, clearAllCache, getCacheStats } from '../tts/chunk-cache.js';
import { getAllBooks } from '../storage/library-db.js';
import { icon } from '../utils/icons.js';

const PREVIEW_BOOK_ID = 'voice-preview';
const PREVIEW_TEXT = 'This is a preview of the selected voice reading your audiobook.';

/**
 * @param {HTMLElement} container
 * @param {{ onBack: () => void }} callbacks
 */
export async function renderSettings(container, { onBack }) {
  const settings = loadTTSSettings();
  const router = new TTSRouter();
  router.configure(settings);

  container.innerHTML = `
    <div class="settings-view">
      <header class="view-header">
        <button class="back-btn icon-btn-touch" id="back-btn" type="button" aria-label="Back">${icon('chevronLeft', 20)} Back</button>
        <h1>Voice Settings</h1>
      </header>
      <form class="settings-form" id="settings-form">
        <label>
          TTS Provider
          <select id="provider-select">
            <option value="web-speech">Web Speech (built-in, free)</option>
            <option value="openai">OpenAI TTS (AI narrator)</option>
          </select>
        </label>
        <label>
          Voice
          <div class="voice-row">
            <select id="voice-select"></select>
            <button type="button" class="preview-btn" id="preview-btn">Preview</button>
          </div>
        </label>
        <label>
          Speed
          <input type="range" id="rate-slider" min="0.5" max="2" step="0.1" value="${settings.rate}">
          <span id="rate-value">${settings.rate}x</span>
        </label>
        <div id="openai-fields" class="openai-fields" hidden>
          <label>
            OpenAI API Key
            <input type="password" id="api-key" placeholder="sk-..." autocomplete="off">
            <small>Stored locally in your browser. Use a local proxy in production.</small>
          </label>
          <label>
            Proxy URL
            <input type="text" id="proxy-url" value="${settings.proxyUrl}">
          </label>
        </div>
        <button type="submit" class="primary-btn">Save Settings</button>
      </form>
      <p class="settings-note" id="save-status"></p>
      <p class="settings-note" id="storage-info">Checking storage…</p>
      <section class="cache-section">
        <h2>AI audio cache</h2>
        <div id="cache-list"><p class="settings-note">Checking cache…</p></div>
      </section>
    </div>
  `;

  const providerSelect = container.querySelector('#provider-select');
  const voiceSelect = container.querySelector('#voice-select');
  const rateSlider = container.querySelector('#rate-slider');
  const rateValue = container.querySelector('#rate-value');
  const openaiFields = container.querySelector('#openai-fields');
  const apiKeyInput = container.querySelector('#api-key');
  const proxyUrlInput = container.querySelector('#proxy-url');
  const saveStatus = container.querySelector('#save-status');

  providerSelect.value = settings.providerId;
  apiKeyInput.value = settings.apiKey;
  proxyUrlInput.value = settings.proxyUrl;
  openaiFields.hidden = settings.providerId !== 'openai';

  providerSelect.addEventListener('change', async () => {
    openaiFields.hidden = providerSelect.value !== 'openai';
    stopPreview();
    await populateVoices();
  });

  rateSlider.addEventListener('input', () => {
    rateValue.textContent = `${rateSlider.value}x`;
  });

  container.querySelector('#back-btn').addEventListener('click', () => {
    stopPreview();
    clearBookCache(PREVIEW_BOOK_ID);
    onBack();
  });

  const previewBtn = container.querySelector('#preview-btn');
  let previewing = false;

  function stopPreview() {
    router.stop();
    previewing = false;
    previewBtn.textContent = 'Preview';
  }

  previewBtn.addEventListener('click', async () => {
    if (previewing) {
      stopPreview();
      return;
    }

    router.configure({
      ...defaultSettings(),
      providerId: providerSelect.value,
      voiceId: voiceSelect.value,
      rate: Number(rateSlider.value),
      apiKey: apiKeyInput.value.trim(),
      proxyUrl: proxyUrlInput.value.trim() || '/api/tts',
    });

    previewing = true;
    previewBtn.textContent = 'Stop';
    router.onComplete = stopPreview;
    router.onError = (err) => {
      stopPreview();
      saveStatus.textContent = `Preview failed: ${err.message}`;
    };
    await router.speak([PREVIEW_TEXT], 0, { bookId: PREVIEW_BOOK_ID, chapterIndex: 0 });
  });

  container.querySelector('#settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const next = {
      ...defaultSettings(),
      providerId: providerSelect.value,
      voiceId: voiceSelect.value,
      rate: Number(rateSlider.value),
      apiKey: apiKeyInput.value.trim(),
      proxyUrl: proxyUrlInput.value.trim() || '/api/tts',
    };
    saveTTSSettings(next);
    saveStatus.textContent = 'Settings saved.';
  });

  async function populateVoices() {
    const tempSettings = {
      ...settings,
      providerId: providerSelect.value,
      apiKey: apiKeyInput.value.trim(),
      proxyUrl: proxyUrlInput.value.trim() || '/api/tts',
    };
    router.configure(tempSettings);

    try {
      const voices = await router.listVoices();
      voiceSelect.innerHTML = voices
        .map(
          (v) =>
            `<option value="${escapeAttr(v.id)}" ${v.id === settings.voiceId ? 'selected' : ''}>${escapeHtml(v.name)}</option>`,
        )
        .join('');
      if (!voices.length) {
        voiceSelect.innerHTML = '<option value="">No voices available</option>';
      }
    } catch {
      voiceSelect.innerHTML = '<option value="">Failed to load voices</option>';
    }
  }

  if (settings.providerId === 'web-speech') {
    speechSynthesis.onvoiceschanged = () => populateVoices();
  }
  await populateVoices();
  await showStorageInfo(container.querySelector('#storage-info'));
  await renderCacheSection(container.querySelector('#cache-list'));

  async function renderCacheSection(el) {
    const stats = await getCacheStats();
    if (!stats.length) {
      el.innerHTML = '<p class="settings-note">No cached AI audio.</p>';
      return;
    }

    const books = await getAllBooks();
    const titles = new Map(books.map((b) => [b.id, b.title]));
    const titleFor = (id) =>
      titles.get(id) ?? (id === PREVIEW_BOOK_ID ? 'Voice previews' : 'Removed book');
    const total = stats.reduce((sum, s) => sum + s.bytes, 0);

    el.innerHTML = `
      ${stats
        .map(
          (s) => `
        <div class="cache-row">
          <span class="cache-title">${escapeHtml(titleFor(s.bookId))}</span>
          <span class="cache-size">${formatBytes(s.bytes)}</span>
          <button type="button" class="cache-clear-btn" data-clear-cache="${escapeAttr(s.bookId)}">Clear</button>
        </div>`,
        )
        .join('')}
      <div class="cache-row cache-row--total">
        <span class="cache-title">Total</span>
        <span class="cache-size">${formatBytes(total)}</span>
        <button type="button" class="cache-clear-btn" id="clear-all-cache">Clear all</button>
      </div>
    `;

    el.querySelectorAll('[data-clear-cache]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await clearBookCache(btn.getAttribute('data-clear-cache'));
        await renderCacheSection(el);
      });
    });

    el.querySelector('#clear-all-cache').addEventListener('click', async () => {
      if (!confirm('Clear all cached AI audio? It will be re-generated (and re-billed) on next listen.')) return;
      await clearAllCache();
      await renderCacheSection(el);
    });
  }
}

/**
 * @param {HTMLElement} el
 */
async function showStorageInfo(el) {
  // Re-request each visit: browsers may grant persistence only after the
  // app is installed to the home screen or used more.
  await requestPersistentStorage();
  const { usage, quota, persisted } = await getStorageInfo();

  if (usage == null && persisted == null) {
    el.textContent = 'Storage details unavailable in this browser.';
    return;
  }

  const usageText = quota != null
    ? `Storage: ${formatBytes(usage)} used of ${formatBytes(quota)} available.`
    : `Storage: ${formatBytes(usage)} used.`;
  const persistText = persisted
    ? 'Your library is protected from automatic deletion.'
    : 'The browser may clear your library if the device runs low on space — keep original files backed up.';

  el.textContent = `${usageText} ${persistText}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return text.replace(/"/g, '&quot;');
}
