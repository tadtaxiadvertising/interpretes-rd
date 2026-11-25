import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { safeNextPath } from '@/lib/auth/safe-next';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

function getConfiguredSiteOrigin(): string {
  const configuredOrigin =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.FRONTEND_ORIGIN ||
    (process.env.NODE_ENV === 'production'
      ? 'https://interpretes.rd.ibusiness.com.do'
      : 'http://localhost:3001');

  return new URL(configuredOrigin).origin;
}

function getSafeNextPath(value: string | null): string {
  const path = safeNextPath(value);
  if (!path) return '/dashboard';
  const base = new URL('https://internal.invalid');
  const target = new URL(path, base);
  if (target.origin !== base.origin || target.pathname.startsWith('//')) return '/dashboard';
  return `${target.pathname}${target.search}${target.hash}`;
}

function redirectWithoutCredentials(path: string, siteOrigin: string) {
  const response = NextResponse.redirect(new URL(path, siteOrigin));
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const nextPath = getSafeNextPath(searchParams.get('next'));
  let siteOrigin: string;
  try {
    siteOrigin = getConfiguredSiteOrigin();
  } catch {
    siteOrigin = 'https://interpretes.rd.ibusiness.com.do';
  }

  const failure = () => redirectWithoutCredentials('/login?error=auth_link_invalid', siteOrigin);

  // Accept only the two email token types needed for activation and recovery.
  // Do not accept a mixture of PKCE and OTP credentials, or redirect to a
  // destination supplied with the email token.
  if (searchParams.has('token_hash')) {
    if (!tokenHash || searchParams.has('code') || (type !== 'invite' && type !== 'recovery')) {
      return failure();
    }
    try {
      const supabase = await createClient();
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (!error && data.session) {
        return redirectWithoutCredentials('/reset-password', siteOrigin);
      }
    } catch (error) {
      console.warn('[AUTH_CALLBACK] Email verification failed:', safeServerErrorCategory(error));
    }
    return failure();
  }

  if (code) {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error && data.session) {
        return redirectWithoutCredentials(nextPath, siteOrigin);
      }
    } catch (error) {
      console.warn('[AUTH_CALLBACK] Code exchange failed:', safeServerErrorCategory(error));
    }
  }

  return failure();
}
