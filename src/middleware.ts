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
  const isTrustedOrigin = !origin ||
    origin === FRONTEND_ORIGIN ||
    origin.endsWith('.easypanel.host') ||
    origin.includes('localhost');

  const corsOrigin = isTrustedOrigin && origin ? origin : FRONTEND_ORIGIN;

  if (req.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': corsOrigin,
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Requested-With',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // ── 2. SUPABASE SESSION REFRESH ───────────────────────────
  // Only run Supabase refresh when a Supabase cookie exists or the route is
  // protected by Supabase. This avoids repeated refresh-token errors for
  // NextAuth-only sessions (e.g. RBAC credentials login).
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

  if (HAS_SUPABASE_ENV && (hasSupabaseCookie || (isSupabaseSecureRoute && !hasValidNextAuthSession))) {
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

  // ── 4. API CORS HEADERS ───────────────────────────────────
  if (pathname.startsWith('/api/')) {
    response.headers.set('Access-Control-Allow-Origin', corsOrigin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
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
