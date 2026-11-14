import { NextResponse } from 'next/server';

/**
 * Responses for invitation validation contain session identifiers and can
 * disclose invitation state. Prevent shared/intermediary cache reuse on ALL
 * outcomes, while preserving rate-limit and other supplied headers.
 */
export function privateRoleplayResponse<T extends object>(
  body: T,
  init: ResponseInit = {},
): NextResponse<T> {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'private, no-store');
  const vary = headers.get('Vary');
  if (!vary?.split(',').some((part) => part.trim().toLowerCase() === 'cookie')) {
    headers.set('Vary', vary ? `${vary}, Cookie` : 'Cookie');
  }
  return NextResponse.json(body, { ...init, headers });
}
