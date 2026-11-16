import { describe, expect, it } from 'vitest';
import {
  assertProviderConsent,
  type ProviderConsent,
  type SpeechProvider,
} from './contracts';

const localProvider: SpeechProvider = {
  id: 'whisper-local',
  label: 'Whisper local',
  processingLocation: 'device',
  async transcribe() {
    return { text: 'hola', language: 'es', isFinal: true };
  },
};

const remoteProvider: SpeechProvider = {
  id: 'user-cloud-provider',
  label: 'Proveedor externo del usuario',
  processingLocation: 'provider',
  async transcribe() {
    return { text: 'hello', language: 'en', isFinal: true };
  },
};

describe('Live provider consent boundary', () => {
  it('allows on-device providers without remote consent', () => {
    expect(() => assertProviderConsent(localProvider, 'transcription', undefined)).not.toThrow();
  });

  it('blocks remote providers when consent is missing', () => {
    expect(() => assertProviderConsent(remoteProvider, 'transcription', undefined))
      .toThrow('EXPLICIT_PROVIDER_CONSENT_REQUIRED');
  });

  it('blocks consent issued for a different provider', () => {
    const consent: ProviderConsent = {
      accepted: true,
      providerId: 'another-provider',
      purpose: 'transcription',
      acceptedAt: new Date().toISOString(),
    };

    expect(() => assertProviderConsent(remoteProvider, 'transcription', consent))
      .toThrow('EXPLICIT_PROVIDER_CONSENT_REQUIRED');
  });

  it('does not reuse transcription consent for translation', () => {
    const consent: ProviderConsent = {
      accepted: true,
      providerId: remoteProvider.id,
      purpose: 'transcription',
      acceptedAt: new Date().toISOString(),
    };

    expect(() => assertProviderConsent(remoteProvider, 'translation', consent))
      .toThrow('EXPLICIT_PROVIDER_CONSENT_REQUIRED');
  });

  it('accepts explicit consent for the selected remote provider', () => {
    const consent: ProviderConsent = {
      accepted: true,
      providerId: remoteProvider.id,
      purpose: 'transcription',
      acceptedAt: new Date().toISOString(),
    };

    expect(() => assertProviderConsent(remoteProvider, 'transcription', consent)).not.toThrow();
  });
});
