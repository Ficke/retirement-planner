/**
 * Simple in-memory rate limiter
 *
 * For production scale, consider upgrading to:
 * - Upstash Redis (@upstash/ratelimit)
 * - Vercel KV
 *
 * Current implementation uses sliding window with in-memory store
 */

interface RateLimitStore {
  requests: number[];
  resetTime: number;
}

class RateLimiter {
  private store = new Map<string, RateLimitStore>();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Cleanup old entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this.store.entries()) {
        if (now > value.resetTime) {
          this.store.delete(key);
        }
      }
    }, 5 * 60 * 1000);
  }

  /**
   * Check if request is allowed
   * @param identifier - Usually IP address or user ID
   * @param limit - Max requests allowed
   * @param windowMs - Time window in milliseconds
   * @returns Object with success status and remaining requests
   */
  async check(
    identifier: string,
    limit: number,
    windowMs: number
  ): Promise<{
    success: boolean;
    remaining: number;
    reset: number;
  }> {
    const now = Date.now();
    const windowStart = now - windowMs;

    let record = this.store.get(identifier);

    if (!record) {
      record = {
        requests: [now],
        resetTime: now + windowMs,
      };
      this.store.set(identifier, record);
      return {
        success: true,
        remaining: limit - 1,
        reset: record.resetTime,
      };
    }

    // Filter out requests outside the current window
    record.requests = record.requests.filter((time) => time > windowStart);

    if (record.requests.length >= limit) {
      const oldestRequest = Math.min(...record.requests);
      return {
        success: false,
        remaining: 0,
        reset: oldestRequest + windowMs,
      };
    }

    // Add current request
    record.requests.push(now);
    record.resetTime = now + windowMs;

    return {
      success: true,
      remaining: limit - record.requests.length,
      reset: record.resetTime,
    };
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }
}

// Singleton instance
const rateLimiter = new RateLimiter();

// Preset configurations
export const RateLimitConfig = {
  // Authentication endpoints - strict limits
  AUTH: {
    limit: 5,
    windowMs: 15 * 60 * 1000, // 5 requests per 15 minutes
  },
  // OCR endpoint - expensive AI calls
  OCR: {
    limit: 10,
    windowMs: 60 * 60 * 1000, // 10 requests per hour
  },
  // Regular API endpoints
  API: {
    limit: 100,
    windowMs: 60 * 1000, // 100 requests per minute
  },
  // Create/Update/Delete operations
  MUTATION: {
    limit: 30,
    windowMs: 60 * 1000, // 30 requests per minute
  },
} as const;

/**
 * Rate limit a request based on IP address
 */
export async function rateLimit(
  identifier: string,
  config: { limit: number; windowMs: number }
) {
  return rateLimiter.check(identifier, config.limit, config.windowMs);
}

/**
 * Get client IP from Next.js request headers
 */
export function getClientIp(headers: Headers): string {
  // Try different headers in order of preference
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  const realIp = headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // Fallback to a default (should rarely happen)
  return 'unknown';
}
