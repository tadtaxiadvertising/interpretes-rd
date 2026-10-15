import { describe, it, expect, afterEach } from 'vitest';
import { isAuthorizedCronRequest } from '@/lib/auth/cron-auth';

const ORIGINAL = process.env.CRON_SECRET;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL;
});

describe('isAuthorizedCronRequest', () => {
  it('fails closed when CRON_SECRET is not configured', () => {
    delete process.env.CRON_SECRET;
    expect(isAuthorizedCronRequest('Bearer secret')).toBe(false);
    expect(isAuthorizedCronRequest('Bearer anything')).toBe(false);
  });

  it('rejects missing, malformed, or wrong credentials', () => {
    process.env.CRON_SECRET = 'super-secret-value';
    expect(isAuthorizedCronRequest(null)).toBe(false);
    expect(isAuthorizedCronRequest(undefined)).toBe(false);
    expect(isAuthorizedCronRequest('')).toBe(false);
    expect(isAuthorizedCronRequest('Bearer wrong')).toBe(false);
    expect(isAuthorizedCronRequest('super-secret-value')).toBe(false);
  });

  it('accepts the exact bearer token', () => {
    process.env.CRON_SECRET = 'super-secret-value';
    expect(isAuthorizedCronRequest('Bearer super-secret-value')).toBe(true);
  });
});
