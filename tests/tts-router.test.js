import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadTTSSettings,
  saveTTSSettings,
  defaultSettings,
  TTSRouter,
} from '../js/tts/tts-router.js';

const SETTINGS_KEY = 'tts-settings';

describe('defaultSettings', () => {
  it('is a speed and a voice', () => {
    expect(defaultSettings()).toEqual({ rate: 1, webSpeechVoiceId: '' });
  });
});

describe('loadTTSSettings', () => {
  beforeEach(() => localStorage.clear());

  it('falls back to defaults when nothing is saved', () => {
    expect(loadTTSSettings()).toEqual(defaultSettings());
  });

  it('falls back to defaults when the saved value is not JSON', () => {
    localStorage.setItem(SETTINGS_KEY, '{nope');
    expect(loadTTSSettings()).toEqual(defaultSettings());
  });

  it('keeps only the speed and voice from settings saved by older versions', () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        rate: 1.5,
        webSpeechVoiceId: 'Samantha',
        providerChain: ['openai'],
        providerConfigs: { openai: { apiKey: 'sk-old' } },
      }),
    );
    expect(loadTTSSettings()).toEqual({ rate: 1.5, webSpeechVoiceId: 'Samantha' });
  });

  it('round-trips through saveTTSSettings', () => {
    const settings = { rate: 2, webSpeechVoiceId: 'Daniel' };
    saveTTSSettings(settings);
    expect(loadTTSSettings()).toEqual(settings);
  });
});

describe('TTSRouter.setRate', () => {
  beforeEach(() => localStorage.clear());

  it('can apply a per-book speed without changing the saved default', () => {
    // Regression: every EPUB speed change was saved as the global default, so
    // all EPUBs (even newly added ones) shared one speed.
    saveTTSSettings({ ...defaultSettings(), rate: 1 });
    const router = new TTSRouter();

    router.setRate(1.75, { saveAsDefault: false });

    expect(router.settings.rate).toBe(1.75);
    expect(loadTTSSettings().rate).toBe(1);
  });

  it('still saves the default when asked (Settings screen behaviour)', () => {
    saveTTSSettings({ ...defaultSettings(), rate: 1 });
    const router = new TTSRouter();

    router.setRate(1.5);

    expect(loadTTSSettings().rate).toBe(1.5);
  });
});
