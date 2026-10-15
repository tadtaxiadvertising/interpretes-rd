import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * UNIFIED MIDDLEWARE — FREE INTERPRETERS OS
 * ============================================================
 * Supabase Auth Only Middleware.
 *
 * CRITICAL DESIGN CONSTRAINTS (Easypanel / ~457 MB RAM):
 *   - Health check bypass MUST be the first check (no I/O)
 *   - Environment variable guards prevent build-time crashes
 *   - Supabase session refresh is conditionally loaded
 *
 * FAULT TOLERANCE:
 *   If env vars are missing at build-time or during static generation,
 *   the middleware logs a warning and passes the request through.
 *   This prevents 502 errors from the container orchestrator before
 *   runtime env vars are injected by Easypanel.
 *
 * FLOW:
 *   req → health check bypass
 *       → static assets bypass
 *       → CORS preflight
 *       → Supabase session refresh (if vars present)
 *       → API CORS headers
 *       → response
 * ============================================================
 */

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "https://freeinterpreters.com";

// Production CORS allowlist — never include .easypanel.host or arbitrary origins
const isProduction = process.env.NODE_ENV === "production";
const AUTH_SESSION_COOKIE_NAMES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
] as const;

function hasAuthSessionCookie(req: NextRequest) {
  return AUTH_SESSION_COOKIE_NAMES.some((name) => req.cookies.has(name));
}

function hasValidAuthSession(req: NextRequest) {
  // Edge-safe gate: only check for Auth.js session cookie presence here.
  // Server Components / Actions perform role validation with Prisma.
  return hasAuthSessionCookie(req);
}

/**
 * Public API prefixes that do NOT require authentication.
 * - /api/health, /api/version: liveness / build-id probes.
 * - /api/auth/*: NextAuth handlers (must be reachable to sign in).
 * - /api/webhooks/*: third-party webhooks (self-verify signatures).
 * - /api/cron/*: scheduled jobs (self-verify CRON_SECRET).
 * - /api/roleplay/*: candidate flow authenticated by one-time invite tokens.
 *
 * Everything else under /api/* requires a verified Supabase session OR a
 * verified Supabase `Authorization: Bearer <token>`.
 */
const API_PUBLIC_PREFIXES = [
  '/api/health',
  '/api/version',
  '/api/auth/',
  '/api/webhooks/',
  '/api/cron/',
  '/api/roleplay/',
] as const;

function isPublicApiPath(pathname: string) {
  return API_PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix)
  );
}

function extractBearer(req: NextRequest): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const [scheme, ...rest] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer') return null;
  const token = rest.join(' ').trim();
  return token || null;
}

/**
 * Verify a Supabase access token in the edge runtime via the public anon key.
 * Never requires the service-role key. Fails closed on any error.
 */
async function verifySupabaseAccessToken(token: string): Promise<boolean> {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return false;

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getUser(token);
    return !error && !!data.user;
  } catch {
    return false;
  }
}

// Pre-check logic moved inside middleware to avoid missing env vars at module load in dev mode.

/** Routes exclusively managed by Supabase Auth */
const SUPABASE_SECURE_PREFIXES = ['/dashboard', '/admin', '/payroll', '/qa', '/production', '/recruitment', '/settings', '/interpreters'] as const;

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const origin = req.headers.get('origin');

  // ── 0. HEALTH CHECK — INSTANT EXIT ────────────────────────
  // Zero I/O, zero imports, zero auth.
  // This MUST be the absolute first check before ANY import or env read
  // to avoid cascading failure when the container cold-starts.
  if (pathname === '/api/health') {
    return new NextResponse(
      JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString(), service: 'free-interpreters-os' }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }

  // ── 1. CORS PREFLIGHT ─────────────────────────────────────
  const isLocalhostOrigin = origin?.includes('localhost') || origin?.includes('127.0.0.1');
  const isTrustedOrigin = !isProduction
    ? origin === FRONTEND_ORIGIN || isLocalhostOrigin
    : origin === FRONTEND_ORIGIN;

  const corsOrigin = isTrustedOrigin && origin ? origin : FRONTEND_ORIGIN;

  if (req.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': corsOrigin,
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Requested-With',
        'Access-Control-Allow-Credentials': isTrustedOrigin ? 'true' : 'false',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // ── 2. SUPABASE SESSION REFRESH ───────────────────────────
  // Only run Supabase refresh when a Supabase cookie exists. This avoids
  // unnecessary auth requests for anonymous visitors and NextAuth-only
  // sessions (for example, RBAC credentials login).
  let response: NextResponse;
  let hasActiveSupabaseSession = false;

  const hasSupabaseCookie =
    req.cookies.has('sb-access-token') ||
    req.cookies.has('sb-refresh-token') ||
    Array.from(req.cookies.getAll()).some(
      (cookie) => cookie.name.startsWith('sb-') && cookie.name.endsWith('-auth-token')
    );

  const hasValidNextAuthSession = hasValidAuthSession(req);

  const isSupabaseSecureRoute = SUPABASE_SECURE_PREFIXES.some(
    (prefix) => pathname.startsWith(prefix)
  );

  const HAS_SUPABASE_ENV = !!(
    (process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim()) &&
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim())
  );

  // Do not contact Supabase solely because a route is protected. Requests with
  // no Supabase session cannot be refreshed, and making that request for every
  // anonymous visitor turns a Supabase connectivity issue into repeated Edge
  // Runtime `fetch failed` errors. Protected routes are redirected below when
  // neither authentication system has a valid session.
  if (HAS_SUPABASE_ENV && hasSupabaseCookie) {
    try {
      const { updateSession } = await import('@/lib/supabase/middleware');
      const refreshResult = await updateSession(req);
      response = refreshResult.response;
      hasActiveSupabaseSession = refreshResult.hasValidSession;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn('[MIDDLEWARE] Supabase session refresh failed:', errorMsg);
      response = NextResponse.next({ request: req });
      hasActiveSupabaseSession = false;
    }
  } else {
    response = NextResponse.next({ request: req });
  }

  // ── 3. SUPABASE AUTH PROTECTION ───────────────────────────
  // Dashboard/Admin/Payroll/QA routes require a Supabase or NextAuth session.
  if (isSupabaseSecureRoute) {
    if (!hasActiveSupabaseSession && !hasValidNextAuthSession) {
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = '/login';
      return NextResponse.redirect(loginUrl);
    }
  }

  // ── 3b. API AUTHENTICATION GATE ───────────────────────────
  // Every /api/* route (except the explicit public allowlist) requires a
  // verified Supabase session OR a verified Supabase Bearer token. Route
  // handlers remain responsible for role / ownership authorization.
  if (pathname.startsWith('/api/') && !isPublicApiPath(pathname)) {
    // Coarse edge gate: a refreshed Supabase session, an Auth.js session
    // cookie, or a verified Supabase Bearer token. Route handlers still
    // enforce role / ownership (see src/lib/api-auth.ts).
    let apiAuthenticated = hasActiveSupabaseSession || hasValidNextAuthSession;
    if (!apiAuthenticated) {
      const bearer = extractBearer(req);
      if (bearer) {
        apiAuthenticated = await verifySupabaseAccessToken(bearer);
      }
    }

    if (!apiAuthenticated) {
      const unauthorized = NextResponse.json(
        { success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
      unauthorized.headers.set('Access-Control-Allow-Origin', corsOrigin);
      unauthorized.headers.set(
        'Access-Control-Allow-Credentials',
        isTrustedOrigin ? 'true' : 'false'
      );
      return unauthorized;
    }
  }

  // ── 4. API CORS HEADERS ───────────────────────────────────
  if (pathname.startsWith('/api/')) {
    response.headers.set('Access-Control-Allow-Origin', corsOrigin);
    response.headers.set('Access-Control-Allow-Credentials', isTrustedOrigin ? 'true' : 'false');
    response.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With');
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
