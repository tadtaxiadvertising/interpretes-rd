import { describe, expect, it } from 'vitest';
import { buildProcessedAudioPath } from './roleplay-audio-conversion';

describe('buildProcessedAudioPath', () => {
  it('creates an immutable MP3 object path for each conversion attempt', () => {
    const source = 'session-1/scenario-1/response.webm';

    const firstAttempt = buildProcessedAudioPath(source, 'attempt-111');
    const secondAttempt = buildProcessedAudioPath(source, 'attempt-222');

    expect(firstAttempt).toBe('session-1/scenario-1/response.attempt-111.mp3');
    expect(secondAttempt).toBe('session-1/scenario-1/response.attempt-222.mp3');
    expect(firstAttempt).not.toBe(secondAttempt);
  });

  it('preserves nested storage paths and accepts uppercase WebM extensions', () => {
    expect(buildProcessedAudioPath('a/b/recording.WEBM', 'worker-1'))
      .toBe('a/b/recording.worker-1.mp3');
  });

  it('rejects non-WebM source paths', () => {
    expect(() => buildProcessedAudioPath('a/b/recording.mp3', 'attempt-1'))
      .toThrow('MP3 conversion requires a WebM source path');
  });

  it('rejects attempt identifiers that could alter the storage path', () => {
    expect(() => buildProcessedAudioPath('a/b/recording.webm', '../other'))
      .toThrow('Invalid audio conversion attempt identifier');
  });
});
