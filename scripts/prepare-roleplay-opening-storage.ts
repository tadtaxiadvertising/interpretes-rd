import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { prepareOpeningStorage } from './roleplay-opening-storage-preflight';

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--check-only', '--create-missing'].includes(args[0])) {
    throw new Error('Specify --check-only or --create-missing.');
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Storage configuration unavailable.');
  const storage = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).storage;
  const status = await prepareOpeningStorage(storage, args[0] === '--create-missing');
  console.log('Opening storage metadata: ' + status);
  console.log('Metadata check only; Storage RLS and runtime activation must be verified separately.');
  if (status !== 'ready' && status !== 'created') process.exitCode = 1;
}

void main().catch(() => {
  console.error('Opening storage preparation failed. No provider details are printed.');
  process.exitCode = 1;
});
