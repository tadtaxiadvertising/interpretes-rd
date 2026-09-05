import { createClient } from '@supabase/supabase-js';

// Load environment variables if they are not already set (e.g. running in standalone Next.js server locally).
// Uses dynamic require() to avoid Edge Runtime warnings since this file is imported by middleware.ts.
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
      } catch (e) {}
    };
    
    loadEnv('.env.local');
    loadEnv('.env');
  } catch (err: any) {
    // silently ignore
  }
}

// ---------------------------------------------------------------------------
// Error sentinel for missing SUPABASE_SERVICE_ROLE_KEY
// Allows consumers to semantically detect this specific failure without
// relying on fragile string matching on error.message.
// ---------------------------------------------------------------------------

/** Standardised user-facing message when admin operations are unavailable. */
export const ADMIN_UNAVAILABLE_MESSAGE =
  'Admin operation unavailable: Missing SUPABASE_SERVICE_ROLE_KEY in runtime config.';

/**
 * Semantic error thrown (or detected) when the Supabase Admin client cannot
 * be initialised because `SUPABASE_SERVICE_ROLE_KEY` is not set.
 */
export class SupabaseAdminUnavailableError extends Error {
  constructor(message?: string) {
    super(message ?? ADMIN_UNAVAILABLE_MESSAGE);
    this.name = 'SupabaseAdminUnavailableError';
  }
}

/**
 * Type-guard to check whether an unknown `catch` value is a
 * `SupabaseAdminUnavailableError`.  Works even across module boundaries
 * where `instanceof` might fail due to duplicate bundles.
 */
export function isAdminUnavailableError(error: unknown): error is SupabaseAdminUnavailableError {
  if (error instanceof SupabaseAdminUnavailableError) return true;
  return (
    error instanceof Error &&
    error.name === 'SupabaseAdminUnavailableError'
  );
}

// ---------------------------------------------------------------------------
// Service-role key resolution (tolerant — logs once, returns empty string)
// ---------------------------------------------------------------------------

let _serviceKeyWarningLogged = false;

/**
 * Resolves the Supabase service-role / secret key.
 *
 * REQUIRED: `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_KEY` must be
 * set as runtime environment variables. No hardcoded fallback is provided.
 *
 * Priority:
 *   1. `SUPABASE_SERVICE_ROLE_KEY` env (legacy JWT `eyJ…` OR new-format `sb_secret_…`).
 *   2. `SUPABASE_SERVICE_KEY` env (same accepted formats).
 */
export function getSupabaseServiceRoleKey(): string {
  const value1 = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const value2 = process.env.SUPABASE_SERVICE_KEY?.trim();
  const envKey = value1 || value2;

  // Accept any non-empty value: legacy JWTs (`eyJ…`) and the modern
  // `sb_secret_…` format are both valid Supabase secret keys.
  if (envKey) return envKey;

  // Also check globalThis just in case it's in a weird context
  if (typeof globalThis !== 'undefined' && (globalThis as any).process?.env?.SUPABASE_SERVICE_ROLE_KEY) {
     const globalKey = ((globalThis as any).process.env.SUPABASE_SERVICE_ROLE_KEY as string).trim();
     if (globalKey) return globalKey;
  }

  // NO HARDCODED FALLBACK — throw to force runtime configuration.
  if (!_serviceKeyWarningLogged) {
    _serviceKeyWarningLogged = true;
    console.error(
      '🔴 [SUPABASE_ADMIN] SUPABASE_SERVICE_ROLE_KEY is not set in runtime environment. ' +
      'Service-role operations are UNAVAILABLE. Set SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) ' +
      'in Easypanel env vars. The hardcoded fallback was REMOVED for security.'
    );
  }
  throw new SupabaseAdminUnavailableError();
}

// ---------------------------------------------------------------------------
// Admin config & client factories
// ---------------------------------------------------------------------------

function createLazyAdminClient() {
  let clientInstance: ReturnType<typeof createClient> | null = null;
  
  return new Proxy({} as any, {
    get(target, prop) {
      if (!clientInstance) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
        const key = getSupabaseServiceRoleKey();
        
        if (!url || !key) {
           throw new SupabaseAdminUnavailableError();
        }
        
        clientInstance = createClient(url, key, {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        });
      }
      return (clientInstance as any)[prop];
    }
  });
}

/**
 * A proxy instance of the Supabase Admin client. 
 * Throws SupabaseAdminUnavailableError on property access if SUPABASE_SERVICE_ROLE_KEY is missing.
 */
export const supabaseAdmin = createLazyAdminClient();
