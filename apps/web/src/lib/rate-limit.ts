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
  private static readonly MAX_STORE_ENTRIES = 10_000;
  private static readonly OVERFLOW_KEY = '__overflow__';
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
    this.cleanupInterval.unref?.();
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

    let storeKey = identifier;
    let record = this.store.get(storeKey);

    // Bound memory under source-address churn. Once the store is full, new
    // identifiers share a deliberately restrictive overflow bucket instead of
    // growing the process heap without limit or evicting entries to bypass the
    // limiter.
    if (!record && this.store.size >= RateLimiter.MAX_STORE_ENTRIES) {
      const namespaceEnd = identifier.indexOf(':');
      const namespace = namespaceEnd > 0 ? identifier.slice(0, namespaceEnd) : 'default';
      storeKey = `${RateLimiter.OVERFLOW_KEY}:${namespace}`;
      record = this.store.get(storeKey);
      if (!record) {
        const oldestKey = this.store.keys().next().value;
        if (oldestKey) this.store.delete(oldestKey);
      }
    }

    if (!record) {
      record = {
        requests: [{ time: now, cost }],
        resetTime: now + windowMs,
      };
      this.store.set(storeKey, record);
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
      const oldestRequest = record.requests[0]?.time ?? now;
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
/**
 * How many addresses this deployment's infrastructure appends to
 * x-forwarded-for. Requests reach Cloud Run directly, and it appends exactly
 * one entry — the real client address — so counting back from the end skips
 * anything a client supplied. Adding a load balancer in front adds a hop and
 * this must change with it.
 */
const TRUSTED_PROXY_HOPS = 1;

export function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get('x-forwarded-for');
  if (!forwardedFor) return 'unknown';

  const addresses = forwardedFor.split(',').map((address) => address.trim()).filter(Boolean);
  return addresses[addresses.length - TRUSTED_PROXY_HOPS] ?? 'unknown';
}
