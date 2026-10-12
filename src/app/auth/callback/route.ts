import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

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
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/dashboard';
  }

  const base = new URL('https://internal.invalid');
  const target = new URL(value, base);
  if (target.origin !== base.origin) return '/dashboard';

  return `${target.pathname}${target.search}${target.hash}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const nextPath = getSafeNextPath(searchParams.get('next'));
  let siteOrigin: string;

  try {
    siteOrigin = getConfiguredSiteOrigin();
  } catch {
    // Fail closed to the known production origin rather than trusting Host or
    // X-Forwarded-Host headers supplied on the incoming recovery callback.
    siteOrigin = 'https://interpretes.rd.ibusiness.com.do';
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(nextPath, siteOrigin));
    }
  }

  return NextResponse.redirect(
    new URL('/login?error=Could%20not%20authenticate%20user', siteOrigin)
  );
}
