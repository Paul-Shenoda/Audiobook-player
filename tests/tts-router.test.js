import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadTTSSettings,
  saveTTSSettings,
  defaultSettings,
  TTSRouter,
} from '../js/tts/tts-router.js';
import { registerTTSProviderFactory } from '../js/tts/provider-interface.js';

const SETTINGS_KEY = 'tts-settings';

describe('defaultSettings', () => {
  it('returns the new provider-chain shape', () => {
    expect(defaultSettings()).toEqual({
      rate: 1,
      providerChain: [],
      providerConfigs: {},
      webSpeechVoiceId: '',
    });
  });
});

describe('loadTTSSettings migration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('migrates an old flat openai settings object into a single-entry chain', () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        providerId: 'openai',
        voiceId: 'nova',
        rate: 1.25,
        apiKey: 'sk-test',
        proxyUrl: '/api/tts',
      }),
    );

    const settings = loadTTSSettings();
    expect(settings.providerChain).toEqual(['openai']);
    expect(settings.providerConfigs.openai).toEqual({
      apiKey: 'sk-test',
      proxyUrl: '/api/tts',
      voiceId: 'nova',
    });
    expect(settings.rate).toBe(1.25);
    expect(settings.providerId).toBeUndefined();
  });

  it('migrates an old flat web-speech settings object into webSpeechVoiceId', () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        providerId: 'web-speech',
        voiceId: 'Samantha',
        rate: 1,
        apiKey: '',
        proxyUrl: '/api/tts',
      }),
    );

    const settings = loadTTSSettings();
    expect(settings.providerChain).toEqual([]);
    expect(settings.webSpeechVoiceId).toBe('Samantha');
  });

  it('leaves an already-migrated settings object unchanged', () => {
    const already = {
      rate: 1.5,
      providerChain: ['elevenlabs', 'openai'],
      providerConfigs: { elevenlabs: { apiKey: 'e-key' }, openai: { apiKey: 'o-key' } },
      webSpeechVoiceId: '',
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(already));

    expect(loadTTSSettings()).toEqual(already);
  });

  it('falls back to defaults when nothing is saved', () => {
    expect(loadTTSSettings()).toEqual(defaultSettings());
  });
});

describe('saveTTSSettings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips through localStorage', () => {
    const settings = { ...defaultSettings(), rate: 2 };
    saveTTSSettings(settings);
    expect(loadTTSSettings()).toEqual(settings);
  });
});

describe('TTSRouter.configure', () => {
  beforeEach(() => {
    registerTTSProviderFactory('fake-a', (config) => ({
      id: 'fake-a',
      name: 'Fake A',
      listVoices: async () => [],
      synthesize: async () => new Blob(),
      __config: config,
    }));
    registerTTSProviderFactory('fake-b', (config) => ({
      id: 'fake-b',
      name: 'Fake B',
      listVoices: async () => [],
      synthesize: async () => new Blob(),
      __config: config,
    }));
  });

  it('builds the provider chain in order from registered factories', () => {
    const router = new TTSRouter();
    router.configure({
      rate: 1,
      providerChain: ['fake-a', 'fake-b'],
      providerConfigs: { 'fake-a': { apiKey: 'a' }, 'fake-b': { apiKey: 'b' } },
      webSpeechVoiceId: '',
    });

    expect(router.providerChain.map((p) => p.id)).toEqual(['fake-a', 'fake-b']);
    expect(router.aiProvider.id).toBe('fake-a');
    expect(router.chainIndex).toBe(0);
  });

  it('filters out unregistered provider ids without throwing', () => {
    const router = new TTSRouter();
    router.configure({
      rate: 1,
      providerChain: ['fake-a', 'no-such-provider'],
      providerConfigs: {},
      webSpeechVoiceId: '',
    });

    expect(router.providerChain.map((p) => p.id)).toEqual(['fake-a']);
  });

  it('has no aiProvider when the chain is empty (Web Speech only)', () => {
    const router = new TTSRouter();
    router.configure(defaultSettings());
    expect(router.aiProvider).toBeNull();
    expect(router.providerChain).toEqual([]);
  });
});
