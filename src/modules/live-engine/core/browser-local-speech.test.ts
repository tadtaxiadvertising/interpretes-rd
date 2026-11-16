import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkOnDeviceSpeechPack,
  installOnDeviceSpeechPack,
  startOnDeviceSpeech,
  supportsOnDeviceSpeech,
} from './browser-local-speech';

class MockRecognizer {
  static available = vi.fn(async () => 'available' as const);
  static install = vi.fn(async () => true);
  static last: MockRecognizer | null = null;
  processLocally = false;
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  abort = vi.fn();
  constructor() { MockRecognizer.last = this; }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  MockRecognizer.last = null;
});

describe('on-device Web Speech boundary', () => {
  it('does not use a browser engine without explicit local capabilities', async () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    expect(supportsOnDeviceSpeech()).toBe(false);
    expect(await checkOnDeviceSpeechPack('es-ES')).toBe('unsupported');
    expect(() => startOnDeviceSpeech('es-ES', vi.fn(), vi.fn(), vi.fn()))
      .toThrow('ON_DEVICE_SPEECH_UNSUPPORTED');
  });

  it('checks and installs language packs with processLocally=true', async () => {
    vi.stubGlobal('SpeechRecognition', MockRecognizer);
    expect(await checkOnDeviceSpeechPack('en-US')).toBe('available');
    expect(MockRecognizer.available).toHaveBeenCalledWith({
      langs: ['en-US'], processLocally: true, quality: 'dictation',
    });
    await installOnDeviceSpeechPack('es-ES');
    expect(MockRecognizer.install).toHaveBeenCalledWith({
      langs: ['es-ES'], processLocally: true, quality: 'dictation',
    });
  });

  it('never starts a recognizer without processLocally enabled', () => {
    vi.stubGlobal('SpeechRecognition', MockRecognizer);
    const onResult = vi.fn();
    const session = startOnDeviceSpeech('es-ES', onResult, vi.fn(), vi.fn());
    const recognizer = MockRecognizer.last!;
    expect(recognizer.processLocally).toBe(true);
    expect(recognizer.lang).toBe('es-ES');
    expect(recognizer.start).toHaveBeenCalledTimes(1);

    recognizer.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: ' hola ' } }] });
    expect(onResult).toHaveBeenCalledWith('hola', true);
    session.stop();
    expect(recognizer.abort).toHaveBeenCalledTimes(1);
    expect(recognizer.onresult).toBeNull();
    session.stop();
    expect(recognizer.abort).toHaveBeenCalledTimes(1);
  });

  it('refuses a constructor missing the local-only flag', () => {
    class UnsafeRecognizer extends MockRecognizer {
      constructor() {
        super();
        delete (this as unknown as Record<string, unknown>).processLocally;
      }
    }
    vi.stubGlobal('SpeechRecognition', UnsafeRecognizer);
    expect(() => startOnDeviceSpeech('en-US', vi.fn(), vi.fn(), vi.fn()))
      .toThrow('ON_DEVICE_SPEECH_UNSUPPORTED');
  });
});
