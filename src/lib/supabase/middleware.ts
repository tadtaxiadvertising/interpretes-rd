import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

type UpdateSessionResult = {
  response: NextResponse;
  hasValidSession: boolean;
};

const AUTH_SESSION_COOKIE_NAMES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
] as const;

function hasAuthSessionCookie(request: NextRequest) {
  return AUTH_SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name));
}

function hasValidAuthSession(request: NextRequest) {
  // Edge-safe gate: only check for Auth.js session cookie presence here.
  // Server Components / Actions perform strict role validation with Prisma.
  return hasAuthSessionCookie(request);
}

function isInvalidRefreshTokenError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as {
    message?: string;
    code?: string;
    name?: string;
    status?: number;
  };

  return (
    maybeError.code === 'refresh_token_not_found' ||
    maybeError.message?.includes('Invalid Refresh Token') ||
    maybeError.message?.includes('Refresh Token Not Found') ||
    (maybeError.name === 'AuthApiError' && maybeError.status === 400)
  );
}

function collectStaleCookieNames(names: Set<string>, request: NextRequest) {
  names.add('sb-access-token');
  names.add('sb-refresh-token');
  request.cookies.getAll().forEach((cookie) => {
    if (cookie.name.startsWith('sb-') && cookie.name.endsWith('-auth-token')) {
      names.add(cookie.name);
    }
  });
}

function applyCookieDeletions(response: NextResponse, names: Set<string>) {
  names.forEach((name) => response.cookies.delete(name));
}

export async function updateSession(request: NextRequest): Promise<UpdateSessionResult> {
  // Guard: if Supabase env vars are missing, let the request pass through
  // instead of crashing the entire server with a 502.
  // Fallback to non-public variants (common in Easypanel runtime).
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
    || process.env.SUPABASE_URL?.trim();
  // ANON KEY FIX: real key from Supabase Dashboard
  // Falls back to env var, then hardcoded real key
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
    || process.env.SUPABASE_ANON_KEY?.trim()
    || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6Ymt5Z3BwcGxrbnlucndtdG1mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMTQ4OTYsImV4cCI6MjA5Mjg5MDg5Nn0.1KafepcZR8r-_TAYNEmA0cxO6gviIeL-2ydi4LSsleo";

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error(
      '⚠️ MIDDLEWARE: Missing Supabase URL or ANON_KEY (tried NEXT_PUBLIC_* and fallback SUPABASE_*). ' +
      'Auth middleware is disabled. Set these as runtime env vars in Easypanel.'
    );
    return { response: NextResponse.next({ request }), hasValidSession: false };
  }
  let supabaseResponse = NextResponse.next({ request });
  const staleCookieNames = new Set<string>();

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // 1. Get the user from Supabase Auth
  let user = null;
  try {
    const { data: { user: currentUser }, error: userError } = await supabase.auth.getUser();
    if (userError) {
      if (isInvalidRefreshTokenError(userError)) {
        collectStaleCookieNames(staleCookieNames, request);
      }
    } else {
      user = currentUser;
    }
  } catch (error: any) {
    if (isInvalidRefreshTokenError(error)) {
      collectStaleCookieNames(staleCookieNames, request);
    } else {
      console.warn('🔴 [MIDDLEWARE] Unexpected Supabase auth error:', error);
    }
  }
  const { pathname } = request.nextUrl;
  const hasValidNextAuthSession = hasValidAuthSession(request);

  const hasValidSession = !!user || hasValidNextAuthSession;

  // 2. Public paths that don't require Supabase auth
  const publicPaths = [
    '/login',
    '/register',
    '/api/health',
    '/health',
    '/forgot-password',
    '/reset-password',
    '/auth',            // Supabase auth callback
    '/unauthorized',    // Error/Access Denied page
  ];
  const isPublic = publicPaths.some((p) => pathname.startsWith(p));
  const isApiRoute = pathname.startsWith('/api/');

  // 3. Handle non-authenticated users
  // API routes pass through so route handlers can return proper 401 JSON;
  // page routes redirect to /login.
  if (!user && !hasValidNextAuthSession && !isPublic && !isApiRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    const redirectResponse = NextResponse.redirect(url);
    applyCookieDeletions(redirectResponse, staleCookieNames);
    return {
      response: redirectResponse,
      hasValidSession: false,
    };
  }

  // 4. Middleware intentionally avoids database-backed role checks.
  // Role authorization belongs in Server Components / Actions where Prisma and
  // Node-only dependencies are available.
  if (hasValidSession && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    const redirectResponse = NextResponse.redirect(url);
    applyCookieDeletions(redirectResponse, staleCookieNames);
    return {
      response: redirectResponse,
      hasValidSession: true,
    };
  }

  // 5. Basic authenticated root redirection without role lookup.
  if (hasValidSession && pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    const redirectResponse = NextResponse.redirect(url);
    applyCookieDeletions(redirectResponse, staleCookieNames);
    return {
      response: redirectResponse,
      hasValidSession: true,
    };
  }

  // Apply stale cookie deletions to the final supabaseResponse
  applyCookieDeletions(supabaseResponse, staleCookieNames);
  return {
    response: supabaseResponse,
    hasValidSession,
  };
}
