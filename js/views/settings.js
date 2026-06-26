import { loadTTSSettings, saveTTSSettings, defaultSettings, TTSRouter } from '../tts/tts-router.js';
import { icon } from '../utils/icons.js';

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
          <select id="voice-select"></select>
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
            <small>Key is stored in localStorage. Never use a real key on a shared device.</small>
          </label>
          <label>
            Proxy URL
            <input type="text" id="proxy-url" value="${escapeAttr(settings.proxyUrl)}">
          </label>
        </div>
        <button type="submit" class="primary-btn">Save Settings</button>
      </form>
      <p class="settings-note" id="save-status"></p>
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
    await populateVoices();
  });

  rateSlider.addEventListener('input', () => {
    rateValue.textContent = `${rateSlider.value}x`;
  });

  container.querySelector('#back-btn').addEventListener('click', onBack);

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
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
