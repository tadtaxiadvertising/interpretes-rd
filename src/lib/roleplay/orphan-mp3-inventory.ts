import type { SupabaseClient } from '@supabase/supabase-js';

const PAGE_SIZE = 1000;
const MAX_FOLDER_DEPTH = 12;

type StorageReader = Pick<SupabaseClient, 'storage'>;
type AudioResponseReference = {
  sourceAudioPath: string | null;
  processedAudioPath: string | null;
};

/**
 * Read-only inventory. Paging is mandatory: a single Storage.list call can
 * silently omit the remaining objects in a busy bucket.
 *
 * Never use this inventory alone to authorize deletion. Offset pages cannot
 * provide a transactionally consistent snapshot while uploads are active.
 */
export async function listRoleplayMp3Paths(
  client: StorageReader,
  bucket = 'roleplay-audio',
  prefix = 'responses',
): Promise<string[]> {
  const paths: string[] = [];

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
        } else if (item.name.toLowerCase().endsWith('.mp3')) {
          paths.push(path);
        }
      }
      if (data.length < PAGE_SIZE) break;
      offset += data.length;
    }
  }

  await walk(prefix, 0);
  return paths;
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
