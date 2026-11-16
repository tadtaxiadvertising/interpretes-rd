import { describe, expect, it } from 'vitest';
import { validateWhisperTranscript } from './whisper-transcript-guard';

describe('local Whisper runaway text safety boundary', () => {
  it('preserves normal EN and Spanish sentences and permitted repetition', () => {
    expect(validateWhisperTranscript(' The patient has a fever. ', 3 * 16_000))
      .toBe('The patient has a fever.');
    expect(validateWhisperTranscript(' No, no, no. ¡No cambie la dosis! ', 2 * 16_000))
      .toBe('No, no, no. ¡No cambie la dosis!');
    expect(validateWhisperTranscript('   ', 16_000)).toBe('');
  });

  it('rejects implausible word count in short and long audio', () => {
    const repeated = new Array(120).fill('fiebre').join(' ');
    expect(() => validateWhisperTranscript(repeated, 4 * 16_000))
      .toThrow('LOCAL_WHISPER_SUSPICIOUS_OUTPUT');
    expect(() => validateWhisperTranscript(repeated, 10 * 16_000))
      .toThrow('LOCAL_WHISPER_SUSPICIOUS_OUTPUT');
  });

  it('rejects a long unbroken generation and never truncates content silently', () => {
    expect(() => validateWhisperTranscript('a'.repeat(8000), 4 * 16_000))
      .toThrow('LOCAL_WHISPER_SUSPICIOUS_OUTPUT');
    expect(() => validateWhisperTranscript('ab '.repeat(500), 10 * 16_000))
      .toThrow('LOCAL_WHISPER_SUSPICIOUS_OUTPUT');
  });

  it('allows normal fast speech and keeps the complete returned text', () => {
    const text = new Array(90).fill('medicina').join(' ');
    expect(validateWhisperTranscript(text, 10 * 16_000)).toBe(text);
  });

  it('rejects malformed model output and invalid sample metadata', () => {
    expect(() => validateWhisperTranscript(null, 16_000))
      .toThrow('LOCAL_WHISPER_INVALID_OUTPUT');
    expect(() => validateWhisperTranscript('hola', 0))
      .toThrow('LOCAL_WHISPER_INVALID_AUDIO');
    expect(() => validateWhisperTranscript('hola', Number.POSITIVE_INFINITY))
      .toThrow('LOCAL_WHISPER_INVALID_AUDIO');
  });
});
