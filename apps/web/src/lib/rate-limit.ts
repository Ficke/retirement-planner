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
  requests: Array<{ time: number; cost: number }>;
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
    windowMs: number,
    cost = 1,
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
        requests: [{ time: now, cost }],
        resetTime: now + windowMs,
      };
      this.store.set(identifier, record);
      return {
        success: true,
        remaining: Math.max(0, limit - cost),
        reset: record.resetTime,
      };
    }

    // Filter out requests outside the current window
    record.requests = record.requests.filter((request) => request.time > windowStart);
    const used = record.requests.reduce((sum, request) => sum + request.cost, 0);

    if (used + cost > limit) {
      const oldestRequest = Math.min(...record.requests.map((request) => request.time));
      return {
        success: false,
        remaining: 0,
        reset: oldestRequest + windowMs,
      };
    }

    // Add current request
    record.requests.push({ time: now, cost });
    record.resetTime = now + windowMs;

    return {
      success: true,
      remaining: Math.max(0, limit - used - cost),
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

/**
 * Rate limit a request based on IP address
 */
export async function rateLimit(
  identifier: string,
  config: { limit: number; windowMs: number },
  cost = 1,
) {
  return rateLimiter.check(identifier, config.limit, config.windowMs, cost);
}

/**
 * Get client IP from Next.js request headers
 */
export function getClientIp(headers: Headers): string {
  // Try different headers in order of preference
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    const addresses = forwardedFor.split(',').map((address) => address.trim()).filter(Boolean);
    // Google load balancers append the client and load-balancer addresses;
    // any values before those may be user supplied.
    return addresses[addresses.length - 2] ?? addresses[addresses.length - 1] ?? 'unknown';
  }

  const realIp = headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // Fallback to a default (should rarely happen)
  return 'unknown';
}
