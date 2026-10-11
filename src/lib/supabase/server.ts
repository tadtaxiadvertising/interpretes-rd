import { createServerClient } from '@supabase/ssr';

// Load environment variables if they are not already set (e.g. running in standalone Next.js server locally).
// Uses dynamic require() to avoid Edge Runtime warnings.
if (typeof window === 'undefined' && typeof (globalThis as any).EdgeRuntime === 'undefined') {
  try {
    const dotenv = require('dotenv');
    const fs = require('fs');
    const path = require('path');
    const getCwd = () => (process as any)['cwd']();

    const loadEnv = (file: string) => {
      try {
        const fullPath = path.resolve(getCwd(), file);
        if (fs.existsSync(fullPath)) {
          const parsed = dotenv.parse(fs.readFileSync(fullPath));
          for (const k in parsed) {
            if (!process.env[k]) process.env[k] = parsed[k];
          }
        }
      } catch (e) { }
    };

    // Try multiple locations for .env files
    loadEnv('.env.local');
    loadEnv('.env');

    // In standalone builds, .env might be in the app root or one level up
    loadEnv('../.env.local');
    loadEnv('../.env');
  } catch {
    // silently ignore
  }
}

const SUPABASE_CONFIG_ERROR = 'SUPABASE_CONFIG_MISSING';

function getSupabasePublicConfig() {
  // Prefer NEXT_PUBLIC_* vars (inlined at build time for client-side),
  // but fall back to the non-public variants when only those are available
  // (common in Easypanel/Docker runtime where NEXT_PUBLIC_ vars may not be set).
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL']?.trim()
    || process.env['SUPABASE_URL']?.trim();
  const key = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']?.trim()
    || process.env['SUPABASE_ANON_KEY']?.trim();

  if (!url || !key) {
    // Diagnostic logging for Easypanel/VPS debugging
    console.error('🔴 [SUPABASE_CONFIG] Missing required environment variables:');
    console.error(`   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL: ${url ? 'SET' : 'MISSING'}`);
    console.error(`   NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_ANON_KEY: ${key ? 'SET' : 'MISSING'}`);
    console.error('   Process cwd:', process.cwd());
    console.error('   Available env keys:', Object.keys(process.env).filter(k => k.includes('SUPABASE')).join(', ') || 'NONE');

    throw new Error(SUPABASE_CONFIG_ERROR);
  }

  return { url, key };
}

export function isSupabaseConfigError(error: unknown): boolean {
  return error instanceof Error && error.message === SUPABASE_CONFIG_ERROR;
}

export async function createClient() {
  // Dynamically import next/headers only when createClient is called,
  // and only in server environment to avoid "imports next/headers which only works in Server Component" error
  // when this module is imported from Client Components (e.g. onboarding/page.tsx)
  let cookieStore;
  if (typeof window === 'undefined') {
    // Server side: safe to import next/headers
    const { cookies: getCookies } = await import('next/headers');
    cookieStore = await getCookies();
  } else {
    // Client side: create a minimal client without cookie-based session
    // This prevents the build error when auth is used from Client Components
    console.warn('[SUPABASE] createClient called on client side; using minimal client without cookie support');
    // Return a client that won't work for cookie-based auth but won't crash the build
    return createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      {
        cookies: {
          getAll() {
            return [];
          },
          setAll() {
            // no-op on client
          },
        },
      }
    );
  }
  const { url, key } = getSupabasePublicConfig();

  return createServerClient(
    url,
    key,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Can be ignored in Server Components (read-only context)
          }
        },
      },
    }
  );
}
