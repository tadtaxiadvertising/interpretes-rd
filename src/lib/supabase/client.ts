'use client';

import { createBrowserClient } from '@supabase/ssr';

const SUPABASE_BROWSER_CONFIG_ERROR = 'SUPABASE_BROWSER_CONFIG_MISSING';

function getSupabaseBrowserConfig() {
  // Prefer NEXT_PUBLIC_* vars (inlined at build time for client-side bundles),
  // fall back to non-public variants for consistency with server.ts / middleware.ts.
  // NOTE: In Next.js client bundles, non-NEXT_PUBLIC_ env vars are stripped at build
  // time, so the SUPABASE_* fallback only works server-side. For browser-side Presence
  // and auth, NEXT_PUBLIC_SUPABASE_ANON_KEY must be set in the deployment environment
  // (Easypanel) and available during build so it gets inlined into the client bundle.
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL']?.trim()
    || process.env['SUPABASE_URL']?.trim();
  const key = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']?.trim()
    || process.env['SUPABASE_ANON_KEY']?.trim();

  if (!url || !key) {
    console.error('🔴 [SUPABASE_BROWSER_CONFIG] Missing required environment variables:');
    console.error(`   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL: ${url ? 'SET' : 'MISSING'}`);
    console.error(`   NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_ANON_KEY: ${key ? 'SET' : 'MISSING'}`);
    console.error('   NOTE: NEXT_PUBLIC_ vars must be set in Easypanel env for client-side to work.');
    console.error('   The app will run with degraded features (no realtime Presence, no browser-side auth).');
    return null;
  }

  return { url, key };
}

export function isSupabaseBrowserConfigError(error: unknown): boolean {
  return error instanceof Error && error.message === SUPABASE_BROWSER_CONFIG_ERROR;
}

export function createClient() {
  const config = getSupabaseBrowserConfig();
  if (!config) return null;
  const { url, key } = config;

  return createBrowserClient(
    url,
    key,
    {
      realtime: {
        timeout: 30000,
        params: {
          eventsPerSecond: 10,
        }
      },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      },
      global: {
        headers: { 'x-application-name': 'interpretes-rd' },
      }
    }
  );
}
