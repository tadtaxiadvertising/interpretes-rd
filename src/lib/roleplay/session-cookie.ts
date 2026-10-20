import { cookies } from 'next/headers';

export const ROLEPLAY_SESSION_COOKIE = 'roleplay_session';

const SESSION_COOKIE_MAX_AGE_SEC = 60 * 60 * 24;

/**
 * Binds the browser to a single roleplay session. The cookie is the opaque,
 * server-issued credential that candidate-facing submit/read paths require;
 * an authenticated candidate identity alone is never sufficient.
 */
export async function setRoleplaySessionCookie(sessionId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ROLEPLAY_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_COOKIE_MAX_AGE_SEC,
    path: '/',
  });
}
