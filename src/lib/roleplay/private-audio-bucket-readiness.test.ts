// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  requirePrivateRoleplayAudioBucket,
  ROLEPLAY_PRIVATE_AUDIO_BUCKET,
  RoleplayPrivateAudioBucketError,
  type RoleplayPrivateBucketReader,
} from './private-audio-bucket-readiness';

const mime = ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/mp4'];
const readyBucket = {
  id: ROLEPLAY_PRIVATE_AUDIO_BUCKET,
  name: ROLEPLAY_PRIVATE_AUDIO_BUCKET,
  public: false,
  file_size_limit: 15 * 1024 * 1024,
  allowed_mime_types: mime,
  created_at: '2026-11-22T00:00:00.000Z',
};

const reader = (data: unknown, error: unknown = null): RoleplayPrivateBucketReader => ({
  getBucket: vi.fn().mockResolvedValue({ data, error }),
});

describe('future roleplay private Storage readiness (not wired to upload)', () => {
  it('accepts the exact new private bucket with bounded media types', async () => {
    const storage = reader(readyBucket);
    await expect(requirePrivateRoleplayAudioBucket(storage))
      .resolves.toBe('roleplay-audio-private');
    expect(storage.getBucket).toHaveBeenCalledOnce();
    expect(storage.getBucket).toHaveBeenCalledWith('roleplay-audio-private');
  });

  it('does not mistake the existing public bucket for private staging', async () => {
    await expect(requirePrivateRoleplayAudioBucket(reader({
      ...readyBucket,
      id: 'roleplay-audio',
      name: 'roleplay-audio',
      public: true,
    }))).rejects.toThrow('ROLEPLAY_PRIVATE_AUDIO_BUCKET_NOT_READY');
  });

  it('fails closed on public access, size mismatch, missing or extra MIME types', async () => {
    const broken: unknown[] = [
      { ...readyBucket, public: true },
      { ...readyBucket, public: null },
      { ...readyBucket, id: 'other' },
      { ...readyBucket, name: 'other' },
      { ...readyBucket, file_size_limit: null },
      { ...readyBucket, file_size_limit: 15 * 1024 * 1024 - 1 },
      { ...readyBucket, file_size_limit: 50 * 1024 * 1024 },
      { ...readyBucket, allowed_mime_types: null },
      { ...readyBucket, allowed_mime_types: [...mime, 'text/html'] },
      { ...readyBucket, allowed_mime_types: [mime[0], mime[0], mime[1], mime[2]] },
      { ...readyBucket, allowed_mime_types: mime.slice(1) },
      null,
      [],
    ];
    for (const entry of broken) {
      await expect(requirePrivateRoleplayAudioBucket(reader(entry)))
        .rejects.toBeInstanceOf(RoleplayPrivateAudioBucketError);
    }
  });

  it('never reflects provider errors, Storage URLs or names in its exception', async () => {
    const privateToken = 'SECRET_PROVIDER_BEARER_AND_PRIVATE_OBJECT_PATH';
    const provider = reader(null, new Error(privateToken));
    let thrown: unknown;
    try {
      await requirePrivateRoleplayAudioBucket(provider);
    } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(RoleplayPrivateAudioBucketError);
    expect(String(thrown)).not.toContain(privateToken);
  });

  it('rejects unavailable and thrown metadata lookups without retrying', async () => {
    const lookup = vi.fn().mockRejectedValue(new Error('PRIVATE_STORAGE_API_KEY'));
    const storage: RoleplayPrivateBucketReader = { getBucket: lookup };
    await expect(requirePrivateRoleplayAudioBucket(storage))
      .rejects.toThrow('ROLEPLAY_PRIVATE_AUDIO_BUCKET_NOT_READY');
    expect(lookup).toHaveBeenCalledOnce();
    await expect(requirePrivateRoleplayAudioBucket(null as unknown as RoleplayPrivateBucketReader))
      .rejects.toThrow('ROLEPLAY_PRIVATE_AUDIO_BUCKET_NOT_READY');
  });
});
