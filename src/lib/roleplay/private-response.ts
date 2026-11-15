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
  // A request may carry an explicit Bearer credential as well as cookies.
  // Keep both dimensions in Vary so intermediary caches never conflate
  // responses belonging to different authentication contexts.
  const varyParts = (headers.get('Vary') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  for (const required of ['Cookie', 'Authorization']) {
    if (!varyParts.some((part) => part.toLowerCase() === required.toLowerCase())) {
      varyParts.push(required);
    }
  }
  headers.set('Vary', varyParts.join(', '));
  return NextResponse.json(body, { ...init, headers });
}
