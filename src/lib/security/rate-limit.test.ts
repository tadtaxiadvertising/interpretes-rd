import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyRateLimit,
  createRateLimitHeaders,
  getClientIdentifier,
  rateLimit,
} from './rate-limit';

describe('rateLimit', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests up to the configured limit and then rejects', () => {
    const config = { maxRequests: 2, windowMs: 60_000, keyPrefix: 'test-limit' };

    expect(rateLimit('client-a', config)).toMatchObject({ success: true, remaining: 1 });
    expect(rateLimit('client-a', config)).toMatchObject({ success: true, remaining: 0 });
    expect(rateLimit('client-a', config)).toMatchObject({
      success: false,
      remaining: 0,
      retryAfter: 60,
    });
  });

  it('starts a fresh window after expiration', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-09T12:00:00.000Z'));
    const config = { maxRequests: 1, windowMs: 1_000, keyPrefix: 'test-expiry' };

    expect(rateLimit('client-a', config).success).toBe(true);
    vi.advanceTimersByTime(1_001);
    expect(rateLimit('client-a', config).success).toBe(true);
  });

  it('rejects invalid limits and unbounded identifiers', () => {
    expect(() => rateLimit('client-a', { maxRequests: 0, windowMs: 1_000 })).toThrow();
    expect(() => rateLimit('client-a', { maxRequests: 1, windowMs: 0 })).toThrow();
    expect(() => rateLimit('x'.repeat(257), { maxRequests: 1, windowMs: 1_000 })).toThrow();
  });

  it('prefers the ingress-normalized real IP and does not trust User-Agent', () => {
    const request = new Request('https://example.test/api', {
      headers: {
        'x-real-ip': '203.0.113.10',
        'x-forwarded-for': '198.51.100.20, 203.0.113.11',
        'user-agent': 'test-agent',
      },
    });

    expect(getClientIdentifier(request)).toBe('203.0.113.10');
    expect(applyRateLimit(request, {
      maxRequests: 1,
      windowMs: 1_000,
      keyPrefix: 'test-client',
    }).success).toBe(true);
  });

  it('preserves active quotas when capacity is exhausted', () => {
    const config = { maxRequests: 1, windowMs: 60_000, keyPrefix: 'test-capacity' };

    expect(rateLimit('protected-client', config).success).toBe(true);
    expect(rateLimit('protected-client', config).success).toBe(false);

    for (let index = 0; index < 9_999; index += 1) {
      expect(rateLimit(`filler-${index}`, config).success).toBe(true);
    }

    const overflow = rateLimit('overflow-client', config);
    expect(overflow).toMatchObject({ success: false, remaining: 0 });
    expect(overflow.retryAfter).toBeGreaterThan(0);

    // An unrelated identifier cannot evict/reset the protected client's quota.
    expect(rateLimit('protected-client', config).success).toBe(false);
  });

  it('emits retry headers only when a request is limited', () => {
    expect(createRateLimitHeaders({
      success: false,
      remaining: 0,
      resetAt: 1_800_000_000_000,
      retryAfter: 30,
    })).toMatchObject({
      'X-RateLimit-Remaining': '0',
      'Retry-After': '30',
    });
  });
});
