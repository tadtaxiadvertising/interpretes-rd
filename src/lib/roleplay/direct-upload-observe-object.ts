import 'server-only';
import { requirePrivateRoleplayAudioBucket, type RoleplayPrivateBucketReader } from './private-audio-bucket-readiness';

type Storage = RoleplayPrivateBucketReader & {
  from(bucket: string): { exists(path: string): Promise<{data: boolean; error: unknown}> };
};

/** Only for canonical paths reconstructed from server-owned reservations.
 * A negative observation is not proof of absence or an upload grant. */
export async function observeReservedObject(storage: Storage, path: string): Promise<boolean> {
  try {
    const bucket = await requirePrivateRoleplayAudioBucket(storage);
    const response = await storage.from(bucket).exists(path);
    if (!response || response.error !== null || typeof response.data !== 'boolean') throw new Error();
    return response.data;
  } catch {
    throw new Error('STORAGE_OBSERVATION_UNAVAILABLE');
  }
}
