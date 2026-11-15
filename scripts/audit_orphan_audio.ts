/**
 * Read-only Roleplay response-audio inventory (WebM, MP4, OGG and MP3).
 *
 * Do NOT delete objects from this audit: live uploads/conversions make
 * storage listing and database reads non-atomic. This script is intentionally
 * not a source-recording cleanup mechanism (see issue #408).
 *
 * Paths and private audio identifiers must never be printed to CI logs.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import prisma from '../src/lib/prisma';
import {
  listRoleplayAudioObjects,
  summarizeRoleplayMp3Inventory,
  summarizeRoleplayAudioInventory,
} from '../src/lib/roleplay/orphan-mp3-inventory';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Storage configuration');

  const storage = createClient(url, key, { auth: { persistSession: false } });
  const [responses, jobs] = await Promise.all([
    prisma.roleplayResponse.findMany({
      select: { sourceAudioPath: true, processedAudioPath: true },
    }),
    prisma.roleplayAudioJob.findMany({
      select: { sourceAudioPath: true },
    }),
  ]);
  const objects = await listRoleplayAudioObjects(storage);
  const mp3Paths = objects
    .filter((object) => object.path.toLowerCase().endsWith('.mp3'))
    .map((object) => object.path);

  const mp3Counts = summarizeRoleplayMp3Inventory(mp3Paths, responses);
  const audioCounts = summarizeRoleplayAudioInventory(objects, responses, jobs);

  // Aged entries are candidates to investigate, NEVER safe-to-delete items.
  // No paths, session IDs, patient information, signed URLs, or provider
  // error messages may be written to GitHub Actions logs.
  console.log(JSON.stringify({
    mode: 'read-only',
    ...mp3Counts,
    ...audioCounts,
    objectsDeleted: 0,
  }, null, 2));
}

async function run() {
  try {
    await main();
  } catch {
    console.error('Roleplay audio audit failed; no objects were modified.');
    process.exitCode = 1;
  } finally {
    try {
      await prisma.$disconnect();
    } catch {
      process.exitCode = 1;
    }
  }
}

// An old workflow may still invoke --delete. Fail rather than silently
// accepting a destructive mode or implying that any cleanup ran.
if (process.argv.slice(2).length > 0) {
  console.error('Unsupported options: Roleplay audio audit is read-only.');
  process.exitCode = 1;
} else {
  void run();
}
