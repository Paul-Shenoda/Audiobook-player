import { loadTTSSettings, saveTTSSettings, TTSRouter } from '../tts/tts-router.js';
import { getStorageInfo, requestPersistentStorage, formatBytes } from '../utils/storage-persist.js';
import { icon } from '../utils/icons.js';
import { openWelcome } from './welcome.js';
import { unlockMediaForAutoplay } from '../utils/audio-unlock.js';

const PREVIEW_TEXT = 'This is a preview of the selected voice reading your book.';

/**
 * @param {HTMLElement} container
 * @param {{ onBack: () => void }} callbacks
 */
export async function renderSettings(container, { onBack }) {
  const settings = loadTTSSettings();

  // Used only to list voices and play the preview.
  const previewRouter = new TTSRouter();

  container.innerHTML = `
    <div class="settings-view">
      <header class="view-header">
        <button class="back-btn icon-btn-touch" id="back-btn" type="button" aria-label="Back">${icon('chevronLeft', 20)} Back</button>
        <h1>Settings</h1>
      </header>
      <p class="settings-note">Read-aloud is experimental and only for EPUB books. It uses your device's built-in voice. Each book keeps its own speed, set on the player.</p>
      <form class="settings-form" id="settings-form">
        <label>
          Voice
          <div class="voice-row">
            <select id="voice-select"></select>
            <button type="button" class="preview-btn" id="preview-btn">Preview</button>
          </div>
        </label>
        <button type="submit" class="primary-btn">Save Settings</button>
      </form>
      <p class="settings-note" id="save-status"></p>
      <p class="settings-note" id="storage-info">Checking storage…</p>
      <section class="about-section">
        <button type="button" class="welcome-open" id="welcome-btn">${icon('info', 20)} How this app works</button>
      </section>
    </div>
  `;

  const saveStatus = container.querySelector('#save-status');
  const voiceSelect = container.querySelector('#voice-select');
  const previewBtn = container.querySelector('#preview-btn');

  container.querySelector('#welcome-btn').addEventListener('click', (e) => openWelcome({ opener: e.currentTarget }));

  container.querySelector('#back-btn').addEventListener('click', () => {
    stopPreview();
    onBack();
  });

  // --- Voice picker and preview ---------------------------------------------

  function populateVoices() {
    const voices = previewRouter.listVoices();
    voiceSelect.innerHTML = voices.length
      ? voices
          .map((v) => `<option value="${escapeAttr(v.id)}" ${v.id === settings.webSpeechVoiceId ? 'selected' : ''}>${escapeHtml(v.name)}</option>`)
          .join('')
      : '<option value="">No voices available</option>';
  }
  populateVoices();
  // The voice list can arrive asynchronously in some browsers.
  speechSynthesis.onvoiceschanged = populateVoices;

  let previewing = false;

  function stopPreview() {
    previewRouter.stop();
    previewing = false;
    previewBtn.textContent = 'Preview';
  }

  previewBtn.addEventListener('click', () => {
    unlockMediaForAutoplay();
    if (previewing) {
      stopPreview();
      return;
    }
    previewRouter.configure({ rate: 1, webSpeechVoiceId: voiceSelect.value });
    previewing = true;
    previewBtn.textContent = 'Stop';
    previewRouter.onComplete = stopPreview;
    previewRouter.onError = (err) => {
      stopPreview();
      saveStatus.textContent = `Preview failed: ${err.message}`;
    };
    previewRouter.speak([PREVIEW_TEXT]);
  });

  // --- Save -----------------------------------------------------------------

  container.querySelector('#settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveTTSSettings({ ...settings, webSpeechVoiceId: voiceSelect.value });
    saveStatus.textContent = 'Settings saved.';
  });

  await showStorageInfo(container.querySelector('#storage-info'));
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
  return String(text).replace(/"/g, '&quot;');
}
