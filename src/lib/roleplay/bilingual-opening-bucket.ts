// Metadata-only helper; the caller supplies the server-side Storage client.
import { BILINGUAL_OPENING_BUCKET, BILINGUAL_OPENING_MAX_BYTES, BILINGUAL_OPENING_MIME_TYPES } from './bilingual-opening';

type BucketReader = { getBucket(id: string): Promise<{ data: unknown; error: unknown }> };

/** Fresh check before every signing operation. Not a substitute for Storage RLS.
 * No legacy bucket fallback, public URL fallback, or auto-reconfiguration.
 */
export async function requireBilingualOpeningBucket(storage: BucketReader): Promise<typeof BILINGUAL_OPENING_BUCKET> {
  try {
    const { data, error } = await storage.getBucket(BILINGUAL_OPENING_BUCKET);
    if (error || !data || typeof data !== 'object') throw new Error();
    const bucket = data as Record<string, unknown>;
    const allowed = new Set<string>(BILINGUAL_OPENING_MIME_TYPES);
    const types = bucket.allowed_mime_types;
    if (bucket.id !== BILINGUAL_OPENING_BUCKET || bucket.name !== BILINGUAL_OPENING_BUCKET ||
        bucket.public !== false || bucket.file_size_limit !== BILINGUAL_OPENING_MAX_BYTES ||
        !Array.isArray(types) || types.length !== allowed.size || new Set(types).size !== allowed.size ||
        !types.every(type => typeof type === 'string' && allowed.has(type))) throw new Error();
    return BILINGUAL_OPENING_BUCKET;
  } catch {
    throw new Error('OPENING_PRIVATE_BUCKET_NOT_READY');
  }
}
