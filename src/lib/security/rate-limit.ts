/**
 * Rate Limiting Utility
 * 
 * In-memory rate limiter for API endpoints.
 * For production, consider using Redis-based solution (e.g., @upstash/ratelimit)
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60 * 1000); // Every minute

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

/**
 * Check and increment rate limit for a given key
 */
export function rateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  const key = `${config.keyPrefix || 'ratelimit'}:${identifier}`;
  const now = Date.now();
  const windowStart = now - config.windowMs;

  const entry = rateLimitStore.get(key);

  if (!entry || entry.resetAt < now) {
    // First request or window expired
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + config.windowMs,
    });
    return {
      success: true,
      remaining: config.maxRequests - 1,
      resetAt: now + config.windowMs,
    };
  }

  if (entry.count >= config.maxRequests) {
    // Rate limited
    return {
      success: false,
      remaining: 0,
      resetAt: entry.resetAt,
      retryAfter: Math.ceil((entry.resetAt - now) / 1000),
    };
  }

  // Increment count
  entry.count++;
  return {
    success: true,
    remaining: config.maxRequests - entry.count,
    resetAt: entry.resetAt,
  };
}

/**
 * Predefined rate limit configs for different endpoints
 */
export const RATE_LIMITS = {
  // Invite validation - strict limit
  inviteValidation: { maxRequests: 5, windowMs: 60 * 1000, keyPrefix: 'invite' } as RateLimitConfig,
  
  // Audio upload - moderate limit
  audioUpload: { maxRequests: 10, windowMs: 60 * 1000, keyPrefix: 'audio' } as RateLimitConfig,
  
  // Session access - lenient
  sessionAccess: { maxRequests: 30, windowMs: 60 * 1000, keyPrefix: 'session' } as RateLimitConfig,
  
  // Evaluation submission - strict
  evaluationSubmit: { maxRequests: 3, windowMs: 60 * 1000, keyPrefix: 'eval' } as RateLimitConfig,
};

/**
 * Get client identifier from request for rate limiting.
 * 
 * Uses a combination of IP and User-Agent to reduce collision risk.
 * In production behind a trusted proxy, the first x-forwarded-for entry
 * is the real client IP. Falls back to a hash of available headers
 * to avoid the 'unknown' bucket sharing problem.
 */
export function getClientIdentifier(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const realIp = req.headers.get('x-real-ip');
  const userAgent = req.headers.get('user-agent') || '';
  
  let ip = 'unknown';
  if (forwarded) {
    ip = forwarded.split(',')[0].trim();
  } else if (realIp) {
    ip = realIp;
  }
  
  // Combine IP with a hash of User-Agent to reduce collision risk.
  // This avoids all "unknown" requests sharing a single bucket.
  const uaHash = simpleHash(userAgent);
  return `${ip}:${uaHash}`;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Apply rate limit and return appropriate response if limited
 */
export function applyRateLimit(
  req: Request,
  config: RateLimitConfig,
  customIdentifier?: string
): RateLimitResult {
  const identifier = customIdentifier || getClientIdentifier(req);
  return rateLimit(identifier, config);
}

/**
 * Create rate limit headers for response
 */
export function createRateLimitHeaders(result: RateLimitResult): HeadersInit {
  return {
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': Math.ceil(result.resetAt / 1000).toString(),
    ...(result.retryAfter ? { 'Retry-After': result.retryAfter.toString() } : {}),
  };
}