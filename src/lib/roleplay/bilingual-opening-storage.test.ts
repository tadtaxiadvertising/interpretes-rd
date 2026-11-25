import { afterEach, describe, expect, it, vi } from 'vitest';
import { measuredOpeningDuration, verifyBilingualOpeningAudio } from './bilingual-opening-storage';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/roleplay', () => ({ getSignedAudioUrl: vi.fn() }));

import { getSignedAudioUrl } from '@/lib/roleplay';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const path = 'openings/session-1/123e4567-e89b-42d3-a456-426614174000.webm';

describe('staged opening audio verifier', () => {
  it('requires final decoded progress and rounds the measured audio duration up', () => {
    expect(measuredOpeningDuration('out_time_us=1000000\nprogress=continue\nout_time_us=42250000\nprogress=end\n')).toBe(43);
    expect(measuredOpeningDuration('out_time_us=300000000\nprogress=end\n')).toBe(300);
  });

  it.each([
    'out_time_us=0\nprogress=end\n',
    'out_time_us=300000001\nprogress=end\n',
    'out_time_us=1000000\nprogress=continue\n',
    'out_time_us=N/A\nprogress=end\n',
    'progress=end\n',
  ])('rejects invalid or incomplete decoded duration', progress => {
    expect(() => measuredOpeningDuration(progress)).toThrow();
  });

  it('rejects a foreign recording before signing or fetching it', async () => {
    vi.mocked(getSignedAudioUrl).mockClear();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(verifyBilingualOpeningAudio('session-2', path)).rejects.toThrow('Invalid opening audio path');
    expect(getSignedAudioUrl).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects oversized objects before decoding', async () => {
    vi.mocked(getSignedAudioUrl).mockResolvedValue('https://storage.example.test/signed');
    const response = new Response(new Uint8Array([1]), { headers: { 'content-length': String(16 * 1024 * 1024) } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(verifyBilingualOpeningAudio('session-1', path)).rejects.toThrow('Unable to verify opening audio');
    expect(response.bodyUsed).toBe(true);
  });

  it('rejects empty or truncated streams without trusting the declared size', async () => {
    vi.mocked(getSignedAudioUrl).mockResolvedValue('https://storage.example.test/signed');
    for (const response of [
      new Response(new Uint8Array()),
      new Response(new Uint8Array([1]), { headers: { 'content-length': '10' } }),
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
      await expect(verifyBilingualOpeningAudio('session-1', path)).rejects.toThrow('Unable to verify opening audio');
    }
  });
});
