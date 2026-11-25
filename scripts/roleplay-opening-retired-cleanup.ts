import { isCanonicalBilingualOpeningPath } from '../src/lib/roleplay/bilingual-opening';

export const MAX_OPENING_CLEANUP_BATCH = 10;
export type RetiredOpening = { path: string; sessionId: string };
type CleanupPort = {
  candidates(limit: number): Promise<RetiredOpening[]>;
  stillEligible(candidate: RetiredOpening): Promise<boolean>;
  remove(path: string): Promise<void>;
  absent(path: string): Promise<boolean>;
};

/** The caller must verify the environment, private bucket and hold the
 * exclusive cleanup lock. Retired keys must remain permanently fenced.
 * Default to preview. Stop on uncertain outcomes; never retry in a loop. */
export async function cleanRetiredOpeningBatch(port: CleanupPort, apply = false) {
  const candidates = await port.candidates(MAX_OPENING_CLEANUP_BATCH);
  if (candidates.length > MAX_OPENING_CLEANUP_BATCH ||
      new Set(candidates.map(row => row.path)).size !== candidates.length ||
      candidates.some(row => !isCanonicalBilingualOpeningPath(row.path, row.sessionId))) {
    throw new Error('Invalid retired opening inventory');
  }
  const result = { candidates: candidates.length, removed: 0, skipped: 0 };
  if (!apply) return result;
  for (const candidate of candidates) {
    if (!(await port.stillEligible(candidate))) {
      result.skipped++;
      continue;
    }
    await port.remove(candidate.path);
    if (!(await port.absent(candidate.path))) throw new Error('Opening deletion not verified');
    result.removed++;
  }
  return result;
}

/** Refuse mismatched projects and unrecognized/custom endpoints. */
export function matchesHostedOpeningProject(storageUrl: string, databaseUrl: string): boolean {
  try {
    const storage = new URL(storageUrl);
    const database = new URL(databaseUrl);
    const ref = /^([a-z0-9]{20})\.supabase\.co$/.exec(storage.hostname)?.[1];
    if (!ref || storage.protocol !== 'https:' || storage.username || storage.password ||
        storage.port || storage.pathname !== '/' || storage.search || storage.hash ||
        !['postgres:', 'postgresql:'].includes(database.protocol)) return false;
    if (database.hostname === 'db.' + ref + '.supabase.co') return true;
    return /^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(database.hostname) &&
      decodeURIComponent(database.username) === 'postgres.' + ref && database.port === '5432';
  } catch { return false; }
}
