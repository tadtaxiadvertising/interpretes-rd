import type { SupabaseClient } from '@supabase/supabase-js';

const PAGE_SIZE = 1000;
const MAX_FOLDER_DEPTH = 12;
const SOURCE_GRACE_PERIOD_MS = 14 * 24 * 60 * 60 * 1000;
const RECORDING_EXTENSION = /\.(?:webm|mp4|ogg|mp3)$/i;

type StorageReader = Pick<SupabaseClient, 'storage'>;
type AudioResponseReference = {
  sourceAudioPath: string | null;
  processedAudioPath: string | null;
};

export type RoleplayAudioObject = {
  path: string;
  createdAt: string | null;
  updatedAt: string | null;
};

/**
 * Read-only traversal of response audio formats accepted by the application.
 * Every folder is paginated, and the list is only an approximate inventory:
 * a paginated Storage list is NOT a snapshot or authorization to delete.
 */
export async function listRoleplayAudioObjects(
  client: StorageReader,
  bucket = 'roleplay-audio',
  prefix = 'responses',
): Promise<RoleplayAudioObject[]> {
  const objects: RoleplayAudioObject[] = [];

  async function walk(folder: string, depth: number): Promise<void> {
    if (depth > MAX_FOLDER_DEPTH) throw new Error('Roleplay audio inventory exceeded folder depth');
    let offset = 0;
    while (true) {
      let result;
      try {
        result = await client.storage.from(bucket).list(folder, {
          limit: PAGE_SIZE,
          offset,
          sortBy: { column: 'name', order: 'asc' },
        });
      } catch {
        // Never reflect Storage errors: they can contain object names or tokens.
        throw new Error('Roleplay audio inventory could not list Storage objects');
      }
      if (result.error || !Array.isArray(result.data)) {
        throw new Error('Roleplay audio inventory could not list Storage objects');
      }
      const data = result.data;
      for (const item of data) {
        if (!item.name || item.name === '.' || item.name === '..') {
          throw new Error('Roleplay audio inventory received an invalid entry');
        }
        const path = `${folder}/${item.name}`;
        if (item.id === null) {
          await walk(path, depth + 1);
        } else if (RECORDING_EXTENSION.test(item.name)) {
          objects.push({
            path,
            createdAt: typeof item.created_at === 'string' ? item.created_at : null,
            updatedAt: typeof item.updated_at === 'string' ? item.updated_at : null,
          });
        }
      }
      if (data.length < PAGE_SIZE) break;
      offset += data.length;
    }
  }

  await walk(prefix, 0);
  return objects;
}

/** Historical MP3-only reporting remains available to existing callers. */
export async function listRoleplayMp3Paths(
  client: StorageReader,
  bucket = 'roleplay-audio',
  prefix = 'responses',
): Promise<string[]> {
  return (await listRoleplayAudioObjects(client, bucket, prefix))
    .filter((item) => item.path.toLowerCase().endsWith('.mp3'))
    .map((item) => item.path);
}

/**
 * A conservative inventory of all accepted recording formats. References
 * from responses AND audio jobs protect objects, even for completed jobs.
 * Only objects with valid old created/updated timestamps are counted as aged
 * candidates. These are NOT safe-to-delete decisions: a concurrent
 * confirmation may still be committing, and list() is not a snapshot.
 *
 * Return aggregate counts only; never print any paths, IDs or metadata.
 */
export function summarizeRoleplayAudioInventory(
  objects: readonly RoleplayAudioObject[],
  responses: readonly AudioResponseReference[],
  jobs: readonly { sourceAudioPath: string }[],
  nowMs = Date.now(),
): {
  scannedAudioObjects: number;
  referencedAudioObjects: number;
  unreferencedYoungerThan14Days: number;
  unreferencedUnknownAge: number;
  unreferencedOlderThan14Days: number;
} {
  const referenced = new Set<string>();
  for (const response of responses) {
    if (response.sourceAudioPath) referenced.add(response.sourceAudioPath);
    if (response.processedAudioPath) referenced.add(response.processedAudioPath);
  }
  for (const job of jobs) if (job.sourceAudioPath) referenced.add(job.sourceAudioPath);

  const unique = new Map<string, RoleplayAudioObject>();
  for (const object of objects) {
    if (!unique.has(object.path)) unique.set(object.path, object);
    else {
      // Inconsistent duplicate listing is not reliable age evidence.
      unique.set(object.path, { path: object.path, createdAt: null, updatedAt: null });
    }
  }

  let referencedCount = 0;
  let young = 0;
  let unknownAge = 0;
  let aged = 0;
  for (const object of unique.values()) {
    if (referenced.has(object.path)) {
      referencedCount++;
      continue;
    }
    const created = object.createdAt ? Date.parse(object.createdAt) : NaN;
    const updated = object.updatedAt ? Date.parse(object.updatedAt) : NaN;
    if (
      !Number.isFinite(nowMs) ||
      !Number.isFinite(created) || !Number.isFinite(updated) ||
      created > nowMs || updated > nowMs
    ) {
      unknownAge++;
    } else if (nowMs - Math.max(created, updated) < SOURCE_GRACE_PERIOD_MS) {
      young++;
    } else {
      aged++;
    }
  }

  return {
    scannedAudioObjects: unique.size,
    referencedAudioObjects: referencedCount,
    unreferencedYoungerThan14Days: young,
    unreferencedUnknownAge: unknownAge,
    unreferencedOlderThan14Days: aged,
  };
}

/**
 * Both original recordings and converted outputs can use .mp3. Counting only
 * processedAudioPath would incorrectly classify legitimate original MP3
 * uploads as orphans.
 *
 * Return aggregate metrics only; paths and identifiers must not enter CI logs.
 */
export function summarizeRoleplayMp3Inventory(
  paths: readonly string[],
  responses: readonly AudioResponseReference[],
): { scannedMp3Objects: number; referencedMp3Objects: number; unreferencedMp3Candidates: number } {
  const referenced = new Set<string>();
  for (const response of responses) {
    if (response.sourceAudioPath) referenced.add(response.sourceAudioPath);
    if (response.processedAudioPath) referenced.add(response.processedAudioPath);
  }
  const uniquePaths = new Set(paths);
  let referencedCount = 0;
  for (const path of uniquePaths) {
    if (referenced.has(path)) referencedCount++;
  }
  return {
    scannedMp3Objects: uniquePaths.size,
    referencedMp3Objects: referencedCount,
    unreferencedMp3Candidates: uniquePaths.size - referencedCount,
  };
}
