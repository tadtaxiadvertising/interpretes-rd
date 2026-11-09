import { describe, expect, it } from 'vitest';
import { buildProcessedAudioPath, parseFfmpegDurationSeconds, summarizeFfmpegStderr } from './roleplay-audio-conversion';

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

describe('summarizeFfmpegStderr', () => {
  it('drops the version banner and keeps the real failure', () => {
    const stderr = [
      'ffmpeg version 7.0.2-static https://johnvansickle.com/ffmpeg/',
      '  built with gcc 8 (Debian 8.3.0-6)',
      '  configuration: --enable-gpl --enable-libmp3lame',
      '  libavutil      59.  8.100 / 59.  8.100',
      'Copyright (c) 2000-2024 the FFmpeg developers',
      'source.webm: Invalid data found when processing input',
      'Conversion failed!',
    ].join('\n');

    const summary = summarizeFfmpegStderr(stderr);

    expect(summary).toContain('Invalid data found when processing input');
    expect(summary).toContain('Conversion failed!');
    expect(summary).not.toContain('ffmpeg version');
    expect(summary).not.toContain('configuration:');
    expect(summary).not.toContain('libavutil');
  });

  it('falls back to raw output when only banner lines exist', () => {
    const summary = summarizeFfmpegStderr('ffmpeg version 7.0.2\n  built with gcc');
    expect(summary.length).toBeGreaterThan(0);
  });

  it('bounds the persisted message length', () => {
    const stderr = Array.from({ length: 40 }, (_, index) => `error line ${index} ${'x'.repeat(100)}`).join('\n');
    expect(summarizeFfmpegStderr(stderr).length).toBeLessThanOrEqual(800);
  });
});

describe('parseFfmpegDurationSeconds', () => {
  it('parses the Duration line from FFmpeg input metadata', () => {
    const stderr = [
      'Input #0, matroska,webm, from \'source.webm\':',
      '  Duration: 00:04:12.34, start: 0.000000, bitrate: 32 kb/s',
    ].join('\n');
    expect(parseFfmpegDurationSeconds(stderr)).toBeCloseTo(252.34, 2);
  });

  it('supports durations longer than an hour', () => {
    expect(parseFfmpegDurationSeconds('Duration: 01:02:03.5, start: 0')).toBeCloseTo(3723.5, 2);
  });

  it('returns null when no duration is present', () => {
    expect(parseFfmpegDurationSeconds('Invalid data found when processing input')).toBeNull();
  });

  it('exposes the platform maximum as five minutes', async () => {
    const { ROLEPLAY_RESPONSE_MAX_DURATION_SEC } = await import('./roleplay-limits');
    expect(ROLEPLAY_RESPONSE_MAX_DURATION_SEC).toBe(300);
  });
});
