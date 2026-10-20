import { timingSafeEqual } from 'node:crypto';

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Fail-closed verification of the cron caller. Returns true only when
 * `CRON_SECRET` is configured AND the request presents the exact
 * `Authorization: Bearer <CRON_SECRET>` header. When `CRON_SECRET` is unset
 * the request is always rejected (no weak fallback).
 */
export function isAuthorizedCronRequest(
  authorizationHeader: string | null | undefined
): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (!authorizationHeader) return false;
  return safeEqual(authorizationHeader, `Bearer ${secret}`);
}
