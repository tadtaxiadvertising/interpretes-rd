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

  it('never returns malformed, signed or otherwise untrusted Storage URLs', async () => {
    const sign = vi.fn();
    const unsafe = [
      `${origin}/storage/v1/object/public/roleplay-audio/base/%2e%2e/clip.mp3`,
      `${origin}/storage/v1/object/public/roleplay-audio/base/../clip.mp3`,
      `${publicUrl}?token=old`,
      `${origin}/storage/v1/object/public/other-bucket/base/clip.mp3`,
      'https://other.supabase.co/storage/v1/object/public/roleplay-audio/base/clip.mp3',
    ];
    for (const url of unsafe) {
      expect(await resolveAdminBaseAudioPlaybackUrl(url, origin, sign)).toBeNull();
    }
    expect(sign).not.toHaveBeenCalled();
  });

  it('omits missing audio or failed first-party signing rather than leaking the old URL', async () => {
    const sign = vi.fn().mockRejectedValue(new Error('Storage unavailable'));
    expect(await resolveAdminBaseAudioPlaybackUrl(null, origin, sign)).toBeNull();
    expect(await resolveAdminBaseAudioPlaybackUrl(publicUrl, origin, sign)).toBeNull();
    expect(sign).toHaveBeenCalledOnce();
  });

  it('blocks Storage links without the configured project origin', async () => {
    const sign = vi.fn();
    expect(await resolveAdminBaseAudioPlaybackUrl(publicUrl, undefined, sign)).toBeNull();
    expect(await resolveAdminBaseAudioPlaybackUrl(`${publicUrl}?token=SECRET`, undefined, sign))
      .toBeNull();
    expect(sign).not.toHaveBeenCalled();
  });

  it('rejects malformed or unsafe-scheme URLs without calling Storage', async () => {
    const sign = vi.fn();
    for (const url of ['not a url', 'javascript:alert(1)', 'http://assets.example/legacy.wav']) {
      expect(await resolveAdminBaseAudioPlaybackUrl(url, origin, sign)).toBeNull();
    }
    expect(sign).not.toHaveBeenCalled();
  });

  it('retains unrelated HTTPS legacy assets if project URL is not configured', async () => {
    const sign = vi.fn();
    const external = 'https://assets.example/legacy.wav';
    expect(await resolveAdminBaseAudioPlaybackUrl(external, undefined, sign)).toBe(external);
    expect(sign).not.toHaveBeenCalled();
  });
});
