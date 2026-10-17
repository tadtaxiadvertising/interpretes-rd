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

  it('falls back to the persisted URL when signing fails', async () => {
    const sign = vi.fn(async () => {
      throw new Error('object not found');
    });

    const url = await resolveResponseAudioUrl(
      { sourceAudioPath: 'responses/s/1.webm', sourceAudioUrl: 'https://persisted/url' },
      sign
    );

    expect(url).toBe('https://persisted/url');
  });

  it('returns null when there is neither a path nor a persisted URL', async () => {
    const url = await resolveResponseAudioUrl({}, vi.fn(async () => 'https://signed/x'));
    expect(url).toBeNull();
  });
});
