import { describe, it, expect, vi } from 'vitest';
import { selectResponseAudioPath, resolveResponseAudioUrl } from '../roleplay-review';

describe('selectResponseAudioPath', () => {
  it('prefers the processed (MP3) path', () => {
    expect(
      selectResponseAudioPath({ processedAudioPath: 'responses/s/1.mp3', sourceAudioPath: 'responses/s/1.webm' })
    ).toBe('responses/s/1.mp3');
  });

  it('falls back to the source path', () => {
    expect(selectResponseAudioPath({ processedAudioPath: null, sourceAudioPath: 'responses/s/1.webm' })).toBe('responses/s/1.webm');
  });

  it('returns null when no path is stored', () => {
    expect(selectResponseAudioPath({ sourceAudioUrl: 'https://old/url' })).toBeNull();
  });
});

describe('resolveResponseAudioUrl', () => {
  it('re-signs the stored path instead of using the persisted URL', async () => {
    const sign = vi.fn(async (path: string) => `https://signed/${path}`);

    const url = await resolveResponseAudioUrl(
      { sourceAudioPath: 'responses/s/1.webm', sourceAudioUrl: 'https://expired/url' },
      sign
    );

    expect(sign).toHaveBeenCalledWith('responses/s/1.webm');
    expect(url).toBe('https://signed/responses/s/1.webm');
  });

  it('prefers the processed path when signing', async () => {
    const sign = vi.fn(async (path: string) => `https://signed/${path}`);

    const url = await resolveResponseAudioUrl(
      { processedAudioPath: 'responses/s/1.mp3', sourceAudioPath: 'responses/s/1.webm' },
      sign
    );

    expect(sign).toHaveBeenCalledWith('responses/s/1.mp3');
    expect(url).toBe('https://signed/responses/s/1.mp3');
  });

  it('falls back to the persisted URL when no path is stored (legacy row)', async () => {
    const sign = vi.fn(async () => 'https://signed/x');

    const url = await resolveResponseAudioUrl({ sourceAudioUrl: 'https://legacy/url' }, sign);

    expect(sign).not.toHaveBeenCalled();
    expect(url).toBe('https://legacy/url');
  });

  it('never returns the old persisted URL when signing a canonical path fails', async () => {
    const sign = vi.fn(async () => {
      throw new Error('object not found');
    });

    const url = await resolveResponseAudioUrl(
      { sourceAudioPath: 'responses/s/1.webm', sourceAudioUrl: 'https://persisted/url' },
      sign
    );

    expect(url).toBeNull();
    expect(sign).toHaveBeenCalledWith('responses/s/1.webm');
  });

  it('falls back to signing the original when converted MP3 is unavailable', async () => {
    const sign = vi.fn(async (path: string) => {
      if (path.endsWith('.mp3')) throw new Error('converted file missing');
      return 'https://signed.test/original.webm';
    });

    const url = await resolveResponseAudioUrl({
      processedAudioPath: 'responses/s/converted.mp3',
      sourceAudioPath: 'responses/s/original.webm',
      sourceAudioUrl: 'https://old.example/expired',
    }, sign);

    expect(url).toBe('https://signed.test/original.webm');
    expect(sign.mock.calls.map(([path]) => path)).toEqual([
      'responses/s/converted.mp3', 'responses/s/original.webm',
    ]);
  });

  it('does not return stale URLs or leak provider errors if both signatures fail', async () => {
    const sign = vi.fn().mockRejectedValue(new Error('https://private.invalid?token=SECRET'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const url = await resolveResponseAudioUrl({
        processedAudioPath: 'responses/s/converted.mp3',
        sourceAudioPath: 'responses/s/source.webm',
        sourceAudioUrl: 'https://persisted.invalid?token=OLD',
      }, sign);
      expect(url).toBeNull();
      expect(sign).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET');
      expect(JSON.stringify(log.mock.calls)).not.toContain('OLD');
    } finally {
      log.mockRestore();
    }
  });

  it('signs a duplicate canonical path only once', async () => {
    const sign = vi.fn().mockRejectedValue(new Error('temporary failure'));
    const url = await resolveResponseAudioUrl({
      processedAudioPath: 'responses/s/audio.mp3',
      sourceAudioPath: 'responses/s/audio.mp3',
    }, sign);
    expect(url).toBeNull();
    expect(sign).toHaveBeenCalledOnce();
  });

  it('returns null when there is neither a path nor a persisted URL', async () => {
    const url = await resolveResponseAudioUrl({}, vi.fn(async () => 'https://signed/x'));
    expect(url).toBeNull();
  });
});
