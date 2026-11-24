import { timingSafeEqual } from 'node:crypto';

export function validEmailSchedulerSecret(value: string | undefined): value is string {
  return typeof value === 'string' && /^[a-fA-F0-9]{64}$/.test(value);
}

/** Dedicated scheduler credential, never a browser session or service-role key. */
export function authorizeEmailScheduler(header: string | null, secret: string | undefined): boolean {
  if (!validEmailSchedulerSecret(secret) || !header || !/^Bearer [a-fA-F0-9]{64}$/.test(header)) return false;
  return timingSafeEqual(Buffer.from(header.slice(7), 'ascii'), Buffer.from(secret, 'ascii'));
}
