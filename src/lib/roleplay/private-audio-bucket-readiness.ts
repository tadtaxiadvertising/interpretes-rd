import { ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES } from '@/lib/roleplay/direct-upload-contract';

/**
 * An isolated, private bucket for FUTURE roleplay uploads only. Never point
 * the existing base-audio library or legacy sessions to this bucket without
 * an authorization-aware playback migration.
 */
export const ROLEPLAY_PRIVATE_AUDIO_BUCKET = 'roleplay-audio-private';

const requiredMimeTypes = new Set([
  'audio/mpeg',
  'audio/wav',
  'audio/webm',
  'audio/mp4',
]);

export class RoleplayPrivateAudioBucketError extends Error {
  constructor() {
    // Do not echo project URLs, provider errors, bucket policies or secrets.
    super('ROLEPLAY_PRIVATE_AUDIO_BUCKET_NOT_READY');
    this.name = 'RoleplayPrivateAudioBucketError';
  }
}

export interface RoleplayPrivateBucketReader {
  getBucket(bucketId: string): Promise<{ data: unknown; error: unknown }>;
}

function isPrivateAudioBucket(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const bucket = value as Record<string, unknown>;

  if (bucket.id !== ROLEPLAY_PRIVATE_AUDIO_BUCKET ||
      bucket.name !== ROLEPLAY_PRIVATE_AUDIO_BUCKET ||
      bucket.public !== false ||
      bucket.file_size_limit !== ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES ||
      !Array.isArray(bucket.allowed_mime_types) ||
      bucket.allowed_mime_types.length !== requiredMimeTypes.size) {
    return false;
  }

  const types = bucket.allowed_mime_types;
  return types.every(mime => typeof mime === 'string' && requiredMimeTypes.has(mime)) &&
    new Set(types).size === requiredMimeTypes.size;
}

/**
 * Server-side metadata gate for a future, authenticated upload-signing route.
 * This is deliberately a fresh read: a previously private bucket may be
 * reconfigured. The future route must fail closed on every signing attempt.
 *
 * This alone grants no access and cannot prove Storage RLS or object identity.
 * Callers must separately authenticate the exact admin and authorization
 * bearer, persist an idempotent reservation, and verify uploaded byte streams
 * before publishing any session. Never pass a browser-owned Storage client.
 */
export async function requirePrivateRoleplayAudioBucket(
  storage: RoleplayPrivateBucketReader,
): Promise<typeof ROLEPLAY_PRIVATE_AUDIO_BUCKET> {
  try {
    if (!storage || typeof storage.getBucket !== 'function') {
      throw new RoleplayPrivateAudioBucketError();
    }
    const response = await storage.getBucket(ROLEPLAY_PRIVATE_AUDIO_BUCKET);
    if (!response || response.error !== null || !isPrivateAudioBucket(response.data)) {
      throw new RoleplayPrivateAudioBucketError();
    }
    return ROLEPLAY_PRIVATE_AUDIO_BUCKET;
  } catch {
    // Storage provider errors may embed credentials and object metadata.
    throw new RoleplayPrivateAudioBucketError();
  }
}
