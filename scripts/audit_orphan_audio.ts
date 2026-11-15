/**
 * Read-only Roleplay MP3 object inventory.
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
  listRoleplayMp3Paths,
  summarizeRoleplayMp3Inventory,
} from '../src/lib/roleplay/orphan-mp3-inventory';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Storage configuration');

  const storage = createClient(url, key, { auth: { persistSession: false } });
  const responses = await prisma.roleplayResponse.findMany({
    select: { sourceAudioPath: true, processedAudioPath: true },
  });
  const paths = await listRoleplayMp3Paths(storage);
  const counts = summarizeRoleplayMp3Inventory(paths, responses);

  // Read-only aggregates; never output source paths, session identifiers,
  // patient information, tokens, or exception messages from providers.
  console.log(JSON.stringify({
    mode: 'read-only',
    ...counts,
    objectsDeleted: 0,
  }, null, 2));
}

async function run() {
  try {
    await main();
  } catch {
    console.error('Roleplay MP3 audit failed; no objects were modified.');
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
  console.error('Unsupported options: Roleplay MP3 audit is read-only.');
  process.exitCode = 1;
} else {
  void run();
}
