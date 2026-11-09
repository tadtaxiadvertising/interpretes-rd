/**
 * Rate limiting utility.
 *
 * This process-local fallback is intentionally bounded. It is not a
 * distributed limiter: multi-instance deployments must use a shared store
 * (for example Redis) for a global quota.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const MAX_RATE_LIMIT_ENTRIES = 10_000;
const CLEANUP_INTERVAL_OPERATIONS = 256;
let operationsSinceCleanup = 0;

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  keyPrefix?: string;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

function validateRateLimitInput(identifier: string, config: RateLimitConfig): void {
  if (!identifier || identifier.length > 256) {
    throw new Error('Rate limit identifier must contain between 1 and 256 characters.');
  }
  if (!Number.isSafeInteger(config.maxRequests) || config.maxRequests < 1) {
    throw new Error('Rate limit maxRequests must be a positive safe integer.');
  }
  if (!Number.isFinite(config.windowMs) || config.windowMs <= 0) {
    throw new Error('Rate limit windowMs must be a positive finite number.');
  }
}

function removeExpiredEntries(now: number): void {
  for (const [key, entry] of rateLimitStore) {
    if (entry.resetAt <= now) rateLimitStore.delete(key);
  }
}

function makeRoom(now: number): void {
  if (rateLimitStore.size < MAX_RATE_LIMIT_ENTRIES) return;

  // Opportunistic cleanup avoids a process-lifetime timer in serverless and
  // constrained runtimes. If still full, evict oldest inserted entries.
  removeExpiredEntries(now);
  while (rateLimitStore.size >= MAX_RATE_LIMIT_ENTRIES) {
    const oldestKey = rateLimitStore.keys().next().value;
    if (oldestKey === undefined) break;
    rateLimitStore.delete(oldestKey);
  }
}

/** Check and increment a process-local rate limit bucket. */
export function rateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  validateRateLimitInput(identifier, config);

  const prefix = config.keyPrefix || 'ratelimit';
  if (prefix.length > 64) {
    throw new Error('Rate limit keyPrefix must not exceed 64 characters.');
  }

  const key = `${prefix}:${identifier}`;
  const now = Date.now();

  operationsSinceCleanup += 1;
  if (operationsSinceCleanup >= CLEANUP_INTERVAL_OPERATIONS) {
    removeExpiredEntries(now);
    operationsSinceCleanup = 0;
  }

  const entry = rateLimitStore.get(key);

  if (!entry || entry.resetAt <= now) {
    makeRoom(now);
    const resetAt = now + config.windowMs;
    rateLimitStore.set(key, { count: 1, resetAt });
    return {
      success: true,
      remaining: Math.max(0, config.maxRequests - 1),
      resetAt,
    };
  }

  if (entry.count >= config.maxRequests) {
    return {
      success: false,
      remaining: 0,
      resetAt: entry.resetAt,
      retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }

  entry.count += 1;
  return {
    success: true,
    remaining: Math.max(0, config.maxRequests - entry.count),
    resetAt: entry.resetAt,
  };
}

/** Predefined rate limits for different endpoints. */
export const RATE_LIMITS = {
  inviteValidation: { maxRequests: 5, windowMs: 60 * 1000, keyPrefix: 'invite' } as RateLimitConfig,
  audioUpload: { maxRequests: 10, windowMs: 60 * 1000, keyPrefix: 'audio' } as RateLimitConfig,
  sessionAccess: { maxRequests: 30, windowMs: 60 * 1000, keyPrefix: 'session' } as RateLimitConfig,
  evaluationSubmit: { maxRequests: 3, windowMs: 60 * 1000, keyPrefix: 'eval' } as RateLimitConfig,
};

/**
 * Get the client identifier from headers normalized by the trusted ingress.
 *
 * The reverse proxy must overwrite (not append to) the selected client-IP
 * header. Never expose this helper directly to an untrusted proxy topology.
 * User-Agent is deliberately excluded: it is attacker-controlled and easy to
 * rotate, so it is not a security boundary or a useful IP substitute.
 */
export function getClientIdentifier(req: Request): string {
  const realIp = req.headers.get('x-real-ip')?.trim();
  const forwarded = req.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim();
  const ip = realIp || forwarded || 'unknown';
  return ip.slice(0, 128);
}

/** Apply a rate limit and return its result. */
export function applyRateLimit(
  req: Request,
  config: RateLimitConfig,
  customIdentifier?: string
): RateLimitResult {
  const identifier = customIdentifier?.trim() || getClientIdentifier(req);
  return rateLimit(identifier, config);
}

/** Create standard rate-limit response headers. */
export function createRateLimitHeaders(result: RateLimitResult): HeadersInit {
  return {
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': Math.ceil(result.resetAt / 1000).toString(),
    ...(result.retryAfter ? { 'Retry-After': result.retryAfter.toString() } : {}),
  };
}
