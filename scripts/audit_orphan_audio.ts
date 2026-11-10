/**
 * Audits (and optionally removes) orphaned MP3 objects in the
 * `roleplay-audio` bucket: files under `responses/` whose path is not present
 * in `roleplay_responses.processed_audio_path`.
 *
 * Dry-run by default. Pass `--delete` to remove the orphans.
 * Never deletes source WebM/MP4 objects, only unreferenced MP3 conversions.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import prisma from '../src/lib/prisma';

const BUCKET = 'roleplay-audio';
const deleteMode = process.argv.includes('--delete');

async function listMp3Objects(storage: any, prefix = 'responses'): Promise<string[]> {
  const out: string[] = [];
  const { data, error } = await storage.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) throw new Error(`list ${prefix}: ${error.message}`);
  for (const entry of data ?? []) {
    const path = `${prefix}/${entry.name}`;
    if (!entry.metadata || entry.id === null) {
      out.push(...(await listMp3Objects(storage, path)));
    } else if (entry.name.toLowerCase().endsWith('.mp3')) {
      out.push(path);
    }
  }
  return out;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env vars missing');
  const storage = createClient(url, key, { auth: { persistSession: false } });

  const referenced = new Set(
    (await prisma.roleplayResponse.findMany({ select: { processedAudioPath: true } }))
      .map((r) => r.processedAudioPath)
      .filter((p): p is string => !!p),
  );

  const all = await listMp3Objects(storage);
  const orphans = all.filter((p) => !referenced.has(p));

  console.log(JSON.stringify({
    mode: deleteMode ? 'delete' : 'dry-run',
    totalMp3Objects: all.length,
    referenced: referenced.size,
    orphans: orphans.length,
    sample: orphans.slice(0, 20),
  }, null, 2));

  if (deleteMode && orphans.length > 0) {
    const { error } = await storage.storage.from(BUCKET).remove(orphans);
    console.log(JSON.stringify({ deleted: orphans.length, error: error?.message ?? null }));
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
