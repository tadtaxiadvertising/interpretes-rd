import { describe, expect, it, vi } from 'vitest';
import { resolveAdminBaseAudioPlaybackUrl } from './admin-base-audio-playback';

const origin = 'https://project.supabase.co';
const path = 'base/session-x/clip-0.mp3';
const publicUrl = `${origin}/storage/v1/object/public/roleplay-audio/${path}`;

describe('resolveAdminBaseAudioPlaybackUrl', () => {
  it('re-signs a verified first-party base clip for the administrator', async () => {
    const sign = vi.fn().mockResolvedValue('https://signed.example/clip');
    const result = await resolveAdminBaseAudioPlaybackUrl(publicUrl, origin, sign);
    expect(result).toBe('https://signed.example/clip');
    expect(sign).toHaveBeenCalledOnce();
    expect(sign).toHaveBeenCalledWith(path);
  });

  it('keeps existing external legacy assets without signing them', async () => {
    const sign = vi.fn();
    const url = 'https://assets.example/legacy.wav';
    expect(await resolveAdminBaseAudioPlaybackUrl(url, origin, sign)).toBe(url);
    expect(sign).not.toHaveBeenCalled();
  });

  it('never signs encoded or query-bearing first-party URLs', async () => {
    const sign = vi.fn();
    const encoded = `${origin}/storage/v1/object/public/roleplay-audio/base/%2e%2e/clip.mp3`;
    const query = `${publicUrl}?token=old`;
    expect(await resolveAdminBaseAudioPlaybackUrl(encoded, origin, sign)).toBe(encoded);
    expect(await resolveAdminBaseAudioPlaybackUrl(query, origin, sign)).toBe(query);
    expect(sign).not.toHaveBeenCalled();
  });

  it('omits missing audio or failed first-party signing rather than leaking the old URL', async () => {
    const sign = vi.fn().mockRejectedValue(new Error('Storage unavailable'));
    expect(await resolveAdminBaseAudioPlaybackUrl(null, origin, sign)).toBeNull();
    expect(await resolveAdminBaseAudioPlaybackUrl(publicUrl, origin, sign)).toBeNull();
    expect(sign).toHaveBeenCalledOnce();
  });

  it('does not derive first-party paths without the configured project origin', async () => {
    const sign = vi.fn();
    expect(await resolveAdminBaseAudioPlaybackUrl(publicUrl, undefined, sign)).toBe(publicUrl);
    expect(sign).not.toHaveBeenCalled();
  });
});
