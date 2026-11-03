import { describe, expect, it } from 'vitest';
import { validateAudioMetadata } from '@/lib/roleplay';

describe('Roleplay base audio metadata validation', () => {
  it('accepts a non-empty MP3 within the upload limit', () => {
    expect(validateAudioMetadata('audio/mpeg', 6_378_133)).toMatchObject({
      valid: true,
      normalizedMime: 'audio/mpeg',
      extension: 'mp3',
    });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid file size %s',
    size => expect(validateAudioMetadata('audio/mpeg', size).valid).toBe(false),
  );

  it('rejects audio larger than 15 MiB', () => {
    expect(validateAudioMetadata('audio/mpeg', 15 * 1024 * 1024 + 1).valid).toBe(false);
  });

  it('rejects unsupported MIME types', () => {
    expect(validateAudioMetadata('application/zip', 1000).valid).toBe(false);
  });

  it.each(['audio/mpeg-fake', 'audio/webm-malicious', 'audio/mp4;evil=1', 'audio/ogg-extra'])('rejects spoofed MIME prefix %s', mime => {
    expect(validateAudioMetadata(mime, 1000).valid).toBe(false);
  });

  it('normalizes browser webm codec MIME types', () => {
    expect(validateAudioMetadata('audio/webm;codecs=opus', 1000)).toMatchObject({
      valid: true,
      extension: 'webm',
    });
  });
});
