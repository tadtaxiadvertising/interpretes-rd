import {
  BILINGUAL_OPENING_BUCKET, BILINGUAL_OPENING_MAX_BYTES, BILINGUAL_OPENING_MIME_TYPES,
} from '../src/lib/roleplay/bilingual-opening';
import { requireBilingualOpeningBucket } from '../src/lib/roleplay/bilingual-opening-bucket';

type StorageResult = { data: unknown; error: unknown };
type StorageAdmin = {
  listBuckets(): Promise<StorageResult>;
  getBucket(id: string): Promise<StorageResult>;
  createBucket(id: string, options: { public: boolean; fileSizeLimit: number; allowedMimeTypes: string[] }): Promise<StorageResult>;
};
export type OpeningStorageStatus = 'ready' | 'missing' | 'misconfigured' | 'unavailable' | 'created';

/**
 * No automatic repairs or deletes. An explicit provisioning run can create
 * only the dedicated bucket, after a successful authoritative listing.
 * Metadata readiness does not establish object-policy isolation.
 */
export async function prepareOpeningStorage(storage: StorageAdmin, createMissing = false): Promise<OpeningStorageStatus> {
  try {
    const result = await storage.listBuckets();
    if (result.error || !Array.isArray(result.data)) return 'unavailable';
    if (result.data.some(bucket => !bucket || typeof bucket.id !== 'string')) return 'unavailable';
    const exists = result.data.some(bucket => bucket.id === BILINGUAL_OPENING_BUCKET);
    if (exists) {
      try {
        await requireBilingualOpeningBucket(storage);
        return 'ready';
      } catch { return 'misconfigured'; }
    }
    if (!createMissing) return 'missing';
    const created = await storage.createBucket(BILINGUAL_OPENING_BUCKET, {
      public: false,
      fileSizeLimit: BILINGUAL_OPENING_MAX_BYTES,
      allowedMimeTypes: [...BILINGUAL_OPENING_MIME_TYPES],
    });
    // An ambiguous response or concurrent creation must be checked by a
    // fresh read. Never overwrite or delete a bucket to recover.
    try {
      await requireBilingualOpeningBucket(storage);
      return created.error ? 'ready' : 'created';
    } catch { return 'unavailable'; }
  } catch { return 'unavailable'; }
}
