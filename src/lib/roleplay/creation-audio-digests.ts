import { ROLEPLAY_ADMIN_AUDIO_MAX_BYTES, ROLEPLAY_MULTIPART_MAX_SCENARIOS } from '@/lib/roleplay-limits';
import { sha256RoleplayFile } from '@/lib/roleplay-streaming-checksum';
import { getAdminRoleplayAudioExtension } from './admin-audio-extension';
import { isParsedMultipartFile } from './parsed-multipart-file';
import type { RoleplayCreationAudioDigest } from './creation-idempotency-ledger';

export class InvalidCreationAudioError extends Error {
  constructor(readonly reason: 'INVALID_AUDIO' | 'INVALID_CHECKSUMS' | 'CHECKSUM_MISMATCH', readonly scenario?: number) {
    super(reason);
    this.name = 'InvalidCreationAudioError';
  }
}

/**
 * Server-only preparation for the future idempotent multipart path.
 * Call after bounded multipart parsing, authorization and scenario validation.
 * Library reuse must use the verified server-side snapshot instead.
 * No claim or Storage write occurs here. Client hashes are optional checks,
 * never a substitute for reading the actual bytes.
 */
export async function collectRoleplayCreationAudioDigests(
  files: readonly unknown[],
  expectedChecksums: readonly (string | null)[] | null = null,
): Promise<RoleplayCreationAudioDigest[]> {
  if (!Array.isArray(files) || files.length < 1 || files.length > ROLEPLAY_MULTIPART_MAX_SCENARIOS) {
    throw new InvalidCreationAudioError('INVALID_AUDIO');
  }
  if (expectedChecksums !== null && (
    !Array.isArray(expectedChecksums) || expectedChecksums.length !== files.length ||
    Array.from(expectedChecksums).some(value => value !== null &&
      (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)))
  )) {
    throw new InvalidCreationAudioError('INVALID_CHECKSUMS');
  }
  // Validate every file before opening even the first stream.
  const validated: File[] = [];
  for (const value of files) {
    if (!isParsedMultipartFile(value) || value.size < 1 || value.size > ROLEPLAY_ADMIN_AUDIO_MAX_BYTES ||
        !getAdminRoleplayAudioExtension(value.type)) {
      throw new InvalidCreationAudioError('INVALID_AUDIO', validated.length + 1);
    }
    validated.push(value);
  }
  const result: RoleplayCreationAudioDigest[] = [];
  // Sequential reads avoid concurrent hash buffers for a full multipart batch.
  for (const [index, file] of validated.entries()) {
    const sha256 = await sha256RoleplayFile(file);
    const expected = expectedChecksums?.[index];
    if (expected && expected.toLowerCase() !== sha256) {
      throw new InvalidCreationAudioError('CHECKSUM_MISMATCH', index + 1);
    }
    result.push({ mime: file.type, sizeBytes: file.size, sha256 });
  }
  return result;
}
