import { describe, expect, it, vi } from 'vitest';
import { resolveInvitationBaseAudioUrl } from './invitation-base-audio';

const origin = 'https://project.supabase.co';
const path = 'base/session-a/0.mp3';
const legacy = `${origin}/storage/v1/object/public/roleplay-audio/${path}`;

describe('resolveInvitationBaseAudioUrl', () => {
  it('signs the canonical session path after invitation authorization', async () => {
    const sign = vi.fn().mockResolvedValue('https://signed.test/canonical.mp3');
    const url = await resolveInvitationBaseAudioUrl({
      baseAudioPath: path, baseAudioUrl: 'https://expired.example/old',
    }, origin, sign);
    expect(url).toBe('https://signed.test/canonical.mp3');
    expect(sign).toHaveBeenCalledWith(path, 3600);
  });

  it('retains legacy flat base recording paths', async () => {
    const sign = vi.fn().mockResolvedValue('https://signed.test/flat.mp3');
    const result = await resolveInvitationBaseAudioUrl({
      baseAudioPath: 'base/legacy-recording.mp3',
    }, origin, sign);
    expect(result).toBe('https://signed.test/flat.mp3');
    expect(sign).toHaveBeenCalledWith('base/legacy-recording.mp3', 3600);
  });

  it('signs a first-party legacy base audio URL', async () => {
    const sign = vi.fn().mockResolvedValue('https://signed.test/legacy.mp3');
    const url = await resolveInvitationBaseAudioUrl({ baseAudioUrl: legacy }, origin, sign);
    expect(url).toBe('https://signed.test/legacy.mp3');
    expect(sign).toHaveBeenCalledWith(path, 3600);
  });

  it('fails closed for Storage URLs if the project origin is not configured', async () => {
    const sign = vi.fn();
    const stored = [
      legacy,
      `${legacy}?token=LEGACY_SECRET`,
      'https://other.supabase.co/storage/v1/object/public/other-bucket/private/audio.mp3',
      `${origin}/storage/v1/object/../../../archive.mp3?token=SECRET`,
      `${origin}/storage/v1/object/../private.mp3`,
    ];
    for (const url of stored) {
      expect(await resolveInvitationBaseAudioUrl({ baseAudioUrl: url }, undefined, sign))
        .toBeNull();
    }
    expect(sign).not.toHaveBeenCalled();
  });

  it('still permits ordinary external legacy audio without the project origin', async () => {
    const sign = vi.fn();
    const external = 'https://assets.example.test/audio/legacy.wav';
    expect(await resolveInvitationBaseAudioUrl({ baseAudioUrl: external }, undefined, sign))
      .toBe(external);
    expect(await resolveInvitationBaseAudioUrl({ baseAudioUrl: 'not a url' }, undefined, sign))
      .toBeNull();
    expect(await resolveInvitationBaseAudioUrl({ baseAudioUrl: 'javascript:alert(1)' }, undefined, sign))
      .toBeNull();
    expect(await resolveInvitationBaseAudioUrl({ baseAudioUrl: 'http://assets.example.test/audio.wav' }, undefined, sign))
      .toBeNull();
    expect(sign).not.toHaveBeenCalled();
  });

  it('keeps unrelated third-party assets for backwards compatibility', async () => {
    const sign = vi.fn();
    const url = 'https://assets.example.test/legacy.wav';
    expect(await resolveInvitationBaseAudioUrl({ baseAudioUrl: url }, origin, sign)).toBe(url);
    expect(sign).not.toHaveBeenCalled();
  });

  it('never returns another project Storage URL even when project origin is configured', async () => {
    const sign = vi.fn();
    const foreign = [
      'https://other.supabase.co/storage/v1/object/public/other-bucket/base/0.mp3',
      'https://other.supabase.co/storage/v1/object/sign/other-bucket/base/0.mp3?token=PRIVATE',
      'https://other.supabase.co/storage/v1/object/../../../export.mp3?token=PRIVATE',
    ];
    for (const url of foreign) {
      expect(await resolveInvitationBaseAudioUrl({ baseAudioUrl: url }, origin, sign))
        .toBeNull();
    }
    expect(sign).not.toHaveBeenCalled();
  });

  it('continues allowing ordinary third-party HTTPS recordings and signing trusted project objects', async () => {
    const sign = vi.fn().mockResolvedValue('https://signed.example/clip.mp3');
    const external = 'https://assets.example.test/legacy/clip.mp3';
    expect(await resolveInvitationBaseAudioUrl({ baseAudioUrl: external }, origin, sign))
      .toBe(external);
    expect(await resolveInvitationBaseAudioUrl({ baseAudioUrl: legacy }, origin, sign))
      .toBe('https://signed.example/clip.mp3');
    expect(sign).toHaveBeenCalledOnce();
    expect(sign).toHaveBeenCalledWith(path, 3600);
  });

  it('does not return untrusted first-party signed or encoded Storage URLs', async () => {
    const sign = vi.fn();
    const urls = [
      `${legacy}?token=expired`,
      `${origin}/storage/v1/object/public/roleplay-audio/base/%2e%2e/0.mp3`,
      `${origin}/storage/v1/object/public/other-bucket/base/session-a/0.mp3`,
    ];
    for (const url of urls) {
      expect(await resolveInvitationBaseAudioUrl({ baseAudioUrl: url }, origin, sign)).toBeNull();
    }
    expect(sign).not.toHaveBeenCalled();
  });

  it('rejects unsafe-scheme legacy assets even when the project URL is set', async () => {
    const sign = vi.fn();
    for (const url of [
      'javascript:alert(1)',
      'data:audio/mpeg;base64,Zm9v',
      'blob:https://project.supabase.co/asset',
      'http://assets.example.test/legacy.mp3',
    ]) {
      expect(await resolveInvitationBaseAudioUrl({ baseAudioUrl: url }, origin, sign))
        .toBeNull();
    }
    expect(sign).not.toHaveBeenCalled();
  });

  it('blocks raw same-project Storage traversal before URL() normalizes the path', async () => {
    const sign = vi.fn();
    const unsafe = [
      `${origin}/storage/v1/object/../../../private.mp3?token=LEGACY_SECRET`,
      `${origin}/storage/v1/object/../private.mp3`,
    ];
    for (const url of unsafe) {
      expect(await resolveInvitationBaseAudioUrl({ baseAudioUrl: url }, origin, sign))
        .toBeNull();
    }
    expect(sign).not.toHaveBeenCalled();
  });

  it('fails closed for malformed canonical keys and failed Storage signatures', async () => {
    const sign = vi.fn().mockRejectedValue(new Error('Storage signing failed'));
    expect(await resolveInvitationBaseAudioUrl({
      baseAudioPath: 'base/../session-a/0.mp3', baseAudioUrl: legacy,
    }, origin, sign)).toBeNull();
    expect(sign).not.toHaveBeenCalled();

    const url = await resolveInvitationBaseAudioUrl({ baseAudioUrl: legacy }, origin, sign);
    expect(url).toBeNull();
    expect(sign).toHaveBeenCalledOnce();
  });

  it('handles missing or empty source references', async () => {
    const sign = vi.fn();
    expect(await resolveInvitationBaseAudioUrl({}, origin, sign)).toBeNull();
    expect(await resolveInvitationBaseAudioUrl({ baseAudioUrl: '' }, origin, sign)).toBeNull();
    expect(sign).not.toHaveBeenCalled();
  });
});
