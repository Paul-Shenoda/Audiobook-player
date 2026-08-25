import { loadTTSSettings, saveTTSSettings, defaultSettings, TTSRouter } from '../tts/tts-router.js';
import { listProviderCatalog, getProviderFactory } from '../tts/provider-interface.js';
import { getMonthlyUsage } from '../tts/usage-tracker.js';
import { getStorageInfo, requestPersistentStorage, formatBytes } from '../utils/storage-persist.js';
import { clearBookCache, clearAllCache, getCacheStats } from '../tts/chunk-cache.js';
import { getAllBooks } from '../storage/library-db.js';
import { icon } from '../utils/icons.js';
import { unlockMediaForAutoplay } from '../utils/audio-unlock.js';

const PREVIEW_BOOK_ID = 'voice-preview';
const PREVIEW_TEXT = 'This is a preview of the selected voice reading your audiobook.';

// BYOK providers keep this fixed relative priority in providerChain no matter
// what order the user toggles them on in — see TTSRouter's provider-chain
// fallback behavior. Any BYOK provider not listed here (future additions)
// is appended after these, in catalog order.
const BYOK_PRIORITY = ['elevenlabs', 'openai', 'google'];

/**
 * @param {HTMLElement} container
 * @param {{ onBack: () => void }} callbacks
 */
export async function renderSettings(container, { onBack }) {
  const settings = loadTTSSettings();
  const catalog = listProviderCatalog();
  const freeProviders = catalog.filter((p) => p.tier === 'free');
  const byokProviders = orderByPriority(catalog.filter((p) => p.tier === 'byok'));

  // Shared router used only for previews — one at a time, reconfigured per click.
  const previewRouter = new TTSRouter();

  container.innerHTML = `
    <div class="settings-view">
      <header class="view-header">
        <button class="back-btn icon-btn-touch" id="back-btn" type="button" aria-label="Back">${icon('chevronLeft', 20)} Back</button>
        <h1>Voice Settings</h1>
      </header>
      <form class="settings-form" id="settings-form">
        <label>
          Speed
          <input type="range" id="rate-slider" min="0.5" max="2" step="0.1" value="${settings.rate}">
          <span id="rate-value">${settings.rate}x</span>
        </label>

        <section class="provider-tier">
          <h2 class="tier-heading">Free &amp; Offline</h2>
          <p class="tier-subtitle">Built in, no account or credit card needed.</p>
          <div class="provider-list">
            ${freeProviders.map((meta) => freeRowShell(meta)).join('')}
          </div>
        </section>

        <section class="provider-tier">
          <h2 class="tier-heading">Bring Your Own Key</h2>
          <p class="tier-subtitle">Connect a paid API for higher-quality AI narration.</p>
          <div class="provider-list">
            ${byokProviders.map((meta) => byokRowShell(meta, settings)).join('')}
          </div>
        </section>

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

  const rateSlider = container.querySelector('#rate-slider');
  const rateValue = container.querySelector('#rate-value');
  const saveStatus = container.querySelector('#save-status');

  rateSlider.addEventListener('input', () => {
    rateValue.textContent = `${rateSlider.value}x`;
  });

  container.querySelector('#back-btn').addEventListener('click', () => {
    stopPreview();
    clearBookCache(PREVIEW_BOOK_ID);
    onBack();
  });

  // --- Preview handling (shared across every provider row) ---------------

  let activePreviewBtn = null;

  function stopPreview() {
    previewRouter.stop();
    if (activePreviewBtn) {
      activePreviewBtn.textContent = 'Preview';
      activePreviewBtn.disabled = false;
    }
    activePreviewBtn = null;
  }

  /**
   * @param {string} providerId 'web-speech' or a registered provider id
   * @param {HTMLButtonElement} btn
   * @param {() => string} getVoiceId
   * @param {() => object} getProviderConfig config to preview with (BYOK fields, etc.)
   */
  function wirePreviewButton(providerId, btn, getVoiceId, getProviderConfig = () => ({})) {
    btn.addEventListener('click', async () => {
      unlockMediaForAutoplay();
      if (activePreviewBtn === btn) {
        stopPreview();
        return;
      }
      stopPreview();

      const rate = Number(rateSlider.value);
      const voiceId = getVoiceId();
      const previewSettings =
        providerId === 'web-speech'
          ? { ...defaultSettings(), rate, webSpeechVoiceId: voiceId }
          : {
              ...defaultSettings(),
              rate,
              providerChain: [providerId],
              providerConfigs: { [providerId]: { ...getProviderConfig(), voiceId } },
            };

      previewRouter.configure(previewSettings);
      activePreviewBtn = btn;
      btn.textContent = 'Stop';
      previewRouter.onComplete = stopPreview;
      previewRouter.onError = (err) => {
        stopPreview();
        saveStatus.textContent = `Preview failed: ${err.message}`;
      };
      await previewRouter.speak([PREVIEW_TEXT], 0, { bookId: PREVIEW_BOOK_ID, chapterIndex: 0 });
    });
  }

  // --- Free & Offline section ---------------------------------------------

  for (const meta of freeProviders) {
    await initFreeProviderRow(meta);
  }

  async function initFreeProviderRow(meta) {
    const body = container.querySelector(`#provider-body-${cssId(meta.id)}`);
    if (!body) return;

    if (meta.id === 'web-speech') {
      body.innerHTML = voicePickerHTML(meta.id);
      wireVoicePicker(meta.id, {
        listVoices: async () => previewRouter.webSpeech.listVoices(),
        selectedVoiceId: settings.webSpeechVoiceId,
      });
      wirePreviewButton(
        'web-speech',
        container.querySelector(`#preview-btn-${cssId(meta.id)}`),
        () => container.querySelector(`#voice-select-${cssId(meta.id)}`)?.value ?? '',
      );
      // Voice list can arrive asynchronously in some browsers.
      speechSynthesis.onvoiceschanged = () => {
        populateVoiceSelect(
          container.querySelector(`#voice-select-${cssId(meta.id)}`),
          () => previewRouter.webSpeech.listVoices(),
          settings.webSpeechVoiceId,
        );
      };
      return;
    }

    const factory = getProviderFactory(meta.id);
    if (!factory) {
      body.innerHTML = '<p class="settings-note">Not available yet.</p>';
      return;
    }

    const savedConfig = settings.providerConfigs?.[meta.id] ?? {};
    let instance;
    try {
      instance = factory({ ...savedConfig, rate: settings.rate });
    } catch {
      body.innerHTML = '<p class="settings-note">Failed to load this provider.</p>';
      return;
    }

    if (typeof instance.isModelDownloaded === 'function') {
      const ready = await Promise.resolve(instance.isModelDownloaded()).catch(() => false);
      if (!ready && typeof instance.downloadModel === 'function') {
        renderDownloadUI(body, meta, instance, savedConfig);
        return;
      }
    }

    renderFreeVoicePicker(body, meta, instance, savedConfig);
  }

  function renderDownloadUI(body, meta, instance, savedConfig) {
    body.innerHTML = `
      <button type="button" class="download-btn" id="download-btn-${cssId(meta.id)}">Download offline voice</button>
      <div class="download-progress" id="download-progress-${cssId(meta.id)}" hidden>
        <div class="download-progress-bar">
          <div class="download-progress-fill" style="width: 0%"></div>
        </div>
        <span class="download-progress-label">0%</span>
      </div>
      <p class="settings-note" id="download-error-${cssId(meta.id)}" hidden></p>
    `;

    const btn = body.querySelector(`#download-btn-${cssId(meta.id)}`);
    const progressWrap = body.querySelector(`#download-progress-${cssId(meta.id)}`);
    const fill = progressWrap.querySelector('.download-progress-fill');
    const label = progressWrap.querySelector('.download-progress-label');
    const errorEl = body.querySelector(`#download-error-${cssId(meta.id)}`);

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      progressWrap.hidden = false;
      errorEl.hidden = true;
      try {
        await instance.downloadModel((progressInfo) => {
          // Only the 'progress' status carries a numeric 0-100 fraction —
          // 'initiate'/'download'/'done'/'ready' are lifecycle markers with
          // no percentage of their own, so leave the bar as-is for those.
          if (progressInfo?.status !== 'progress' || typeof progressInfo.progress !== 'number') return;
          const clamped = Math.max(0, Math.min(100, Math.round(progressInfo.progress)));
          fill.style.width = `${clamped}%`;
          label.textContent = `${clamped}%`;
        });
        renderFreeVoicePicker(body, meta, instance, savedConfig);
      } catch (err) {
        btn.disabled = false;
        errorEl.hidden = false;
        errorEl.textContent = `Download failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    });
  }

  function renderFreeVoicePicker(body, meta, instance, savedConfig) {
    const enabled = settings.providerChain?.includes(meta.id) ?? false;
    body.innerHTML = `
      <label class="provider-toggle">
        <input type="checkbox" id="enable-${cssId(meta.id)}" ${enabled ? 'checked' : ''}>
        <span>Use as my narrator</span>
      </label>
      ${voicePickerHTML(meta.id)}
    `;
    wireVoicePicker(meta.id, {
      listVoices: () => instance.listVoices(),
      selectedVoiceId: savedConfig.voiceId ?? '',
    });
    wirePreviewButton(
      meta.id,
      body.querySelector(`#preview-btn-${cssId(meta.id)}`),
      () => body.querySelector(`#voice-select-${cssId(meta.id)}`)?.value ?? '',
    );
  }

  // --- Bring Your Own Key section -----------------------------------------

  for (const meta of byokProviders) {
    initByokProviderRow(meta);
  }

  function initByokProviderRow(meta) {
    const id = meta.id;
    const enableBox = container.querySelector(`#enable-${cssId(id)}`);
    const configWrap = container.querySelector(`#provider-config-${cssId(id)}`);
    if (!enableBox || !configWrap) return;

    const fieldValue = (key) => container.querySelector(`#field-${cssId(id)}-${cssId(key)}`)?.value ?? '';

    const buildConfig = () => {
      const config = {};
      for (const field of meta.configFields ?? []) {
        const raw = fieldValue(field.key).trim();
        config[field.key] = raw || (field.key === 'proxyUrl' ? '/api/tts' : '');
      }
      return config;
    };

    const requiredFieldsFilled = () =>
      (meta.configFields ?? []).every((field) => field.key === 'proxyUrl' || fieldValue(field.key).trim() !== '');

    const voiceArea = configWrap.querySelector(`#voice-area-${cssId(id)}`);

    const refreshVoiceArea = () => {
      if (!requiredFieldsFilled()) {
        voiceArea.innerHTML = '';
        return;
      }
      if (!voiceArea.querySelector(`#voice-select-${cssId(id)}`)) {
        voiceArea.innerHTML = voicePickerHTML(id);
        const factory = getProviderFactory(id);
        wireVoicePicker(id, {
          listVoices: () => factory(buildConfig()).listVoices(),
          selectedVoiceId: settings.providerConfigs?.[id]?.voiceId ?? '',
        });
        wirePreviewButton(
          id,
          voiceArea.querySelector(`#preview-btn-${cssId(id)}`),
          () => voiceArea.querySelector(`#voice-select-${cssId(id)}`)?.value ?? '',
          buildConfig,
        );
      }
    };

    configWrap.querySelectorAll('input[data-config-key]').forEach((input) => {
      input.addEventListener('input', refreshVoiceArea);
    });

    enableBox.addEventListener('change', () => {
      configWrap.hidden = !enableBox.checked;
      if (enableBox.checked) refreshVoiceArea();
      else stopPreview();
    });

    if (enableBox.checked) refreshVoiceArea();

    const usage = getMonthlyUsage(id);
    const usageEl = configWrap.querySelector(`#usage-${cssId(id)}`);
    if (usageEl && usage > 0) {
      usageEl.textContent = `${usage.toLocaleString()} characters used this month.`;
      usageEl.hidden = false;
    }
  }

  // --- Save ----------------------------------------------------------------

  container.querySelector('#settings-form').addEventListener('submit', (e) => {
    e.preventDefault();

    const providerConfigs = {};
    const chain = [];

    for (const meta of byokProviders) {
      const enableBox = container.querySelector(`#enable-${cssId(meta.id)}`);
      const config = {};
      for (const field of meta.configFields ?? []) {
        const raw = container.querySelector(`#field-${cssId(meta.id)}-${cssId(field.key)}`)?.value.trim() ?? '';
        config[field.key] = raw || (field.key === 'proxyUrl' ? '/api/tts' : '');
      }
      const voiceSelect = container.querySelector(`#voice-select-${cssId(meta.id)}`);
      config.voiceId = voiceSelect?.value ?? '';
      providerConfigs[meta.id] = config;
      if (enableBox?.checked) chain.push(meta.id);
    }

    for (const meta of freeProviders) {
      if (meta.id === 'web-speech') continue;
      const voiceSelect = container.querySelector(`#voice-select-${cssId(meta.id)}`);
      if (voiceSelect) providerConfigs[meta.id] = { voiceId: voiceSelect.value ?? '' };
      // Free providers (e.g. Kokoro) slot in after BYOK as a good free
      // fallback — try what the user is paying for first, then this,
      // then Web Speech (which is never itself in the chain) last.
      const enableBox = container.querySelector(`#enable-${cssId(meta.id)}`);
      if (enableBox?.checked) chain.push(meta.id);
    }

    const webSpeechVoiceId = container.querySelector(`#voice-select-${cssId('web-speech')}`)?.value ?? '';

    const next = {
      rate: Number(rateSlider.value),
      providerChain: chain,
      providerConfigs,
      webSpeechVoiceId,
    };

    saveTTSSettings(next);
    saveStatus.textContent = 'Settings saved.';
  });

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

  // --- Shared voice-picker helpers ------------------------------------------

  function wireVoicePicker(id, { listVoices, selectedVoiceId }) {
    const select = container.querySelector(`#voice-select-${cssId(id)}`);
    if (select) populateVoiceSelect(select, listVoices, selectedVoiceId);
  }

  async function populateVoiceSelect(select, listVoices, selectedVoiceId) {
    if (!select) return;
    try {
      const voices = await listVoices();
      select.innerHTML = voices
        .map(
          (v) =>
            `<option value="${escapeAttr(v.id)}" ${v.id === selectedVoiceId ? 'selected' : ''}>${escapeHtml(v.name)}</option>`,
        )
        .join('');
      if (!voices.length) {
        select.innerHTML = '<option value="">No voices available</option>';
      }
    } catch {
      select.innerHTML = '<option value="">Failed to load voices</option>';
    }
  }
}

/**
 * @param {import('../tts/provider-interface.js').TTSProviderMeta} meta
 */
function freeRowShell(meta) {
  return `
    <div class="provider-row" data-provider="${escapeAttr(meta.id)}">
      <div class="provider-row-header">
        <span class="provider-name">${escapeHtml(meta.name)}</span>
      </div>
      ${meta.description ? `<p class="provider-desc">${escapeHtml(meta.description)}</p>` : ''}
      ${meta.limitations ? `<p class="provider-caveat">${escapeHtml(meta.limitations)}</p>` : ''}
      <div class="provider-body" id="provider-body-${cssId(meta.id)}">
        <p class="settings-note">Loading…</p>
      </div>
    </div>
  `;
}

/**
 * @param {import('../tts/provider-interface.js').TTSProviderMeta} meta
 * @param {import('../tts/tts-router.js').TTSSettings} settings
 */
function byokRowShell(meta, settings) {
  const enabled = settings.providerChain?.includes(meta.id) ?? false;
  const savedConfig = settings.providerConfigs?.[meta.id] ?? {};

  return `
    <div class="provider-row" data-provider="${escapeAttr(meta.id)}">
      <div class="provider-row-header">
        <label class="provider-toggle">
          <input type="checkbox" id="enable-${cssId(meta.id)}" ${enabled ? 'checked' : ''}>
          <span class="provider-name">${escapeHtml(meta.name)}</span>
        </label>
      </div>
      ${meta.description ? `<p class="provider-desc">${escapeHtml(meta.description)}</p>` : ''}
      ${meta.limitations ? `<p class="provider-caveat">${escapeHtml(meta.limitations)}</p>` : ''}
      ${meta.requiresProxy ? '<p class="provider-caveat">Requires running your own proxy/relay server.</p>' : ''}
      <div class="provider-config" id="provider-config-${cssId(meta.id)}" ${enabled ? '' : 'hidden'}>
        ${(meta.configFields ?? []).map((field) => configFieldHTML(meta.id, field, savedConfig[field.key])).join('')}
        <p class="settings-note provider-usage" id="usage-${cssId(meta.id)}" hidden></p>
        <div class="provider-voice" id="voice-area-${cssId(meta.id)}"></div>
      </div>
    </div>
  `;
}

/**
 * @param {string} providerId
 * @param {import('../tts/provider-interface.js').TTSConfigField} field
 * @param {string} [value]
 */
function configFieldHTML(providerId, field, value) {
  return `
    <label>
      ${escapeHtml(field.label)}
      <input
        type="${field.type === 'password' ? 'password' : 'text'}"
        id="field-${cssId(providerId)}-${cssId(field.key)}"
        data-config-key="${escapeAttr(field.key)}"
        value="${escapeAttr(value ?? '')}"
        placeholder="${escapeAttr(field.placeholder ?? '')}"
        autocomplete="off"
      >
      ${field.help ? `<small>${escapeHtml(field.help)}</small>` : ''}
    </label>
  `;
}

function voicePickerHTML(id) {
  return `
    <label>
      Voice
      <div class="voice-row">
        <select id="voice-select-${cssId(id)}"></select>
        <button type="button" class="preview-btn" id="preview-btn-${cssId(id)}">Preview</button>
      </div>
    </label>
  `;
}

/**
 * Order BYOK providers by the fixed priority list, appending any unlisted
 * ones (future providers) after, in their catalog order.
 * @param {import('../tts/provider-interface.js').TTSProviderMeta[]} providers
 */
function orderByPriority(providers) {
  return [...providers].sort((a, b) => {
    const ai = BYOK_PRIORITY.indexOf(a.id);
    const bi = BYOK_PRIORITY.indexOf(b.id);
    const aRank = ai === -1 ? BYOK_PRIORITY.length : ai;
    const bRank = bi === -1 ? BYOK_PRIORITY.length : bi;
    return aRank - bRank;
  });
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

/** Turns a provider/field id into a safe DOM id fragment. */
function cssId(text) {
  return String(text).replace(/[^a-zA-Z0-9_-]/g, '-');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return String(text).replace(/"/g, '&quot;');
}
