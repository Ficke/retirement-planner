import { DurableObject } from 'cloudflare:workers';

/**
 * An exact, globally consistent counter over a fixed window.
 *
 * The Workers rate-limit binding is per-colo, eventually consistent, and has no
 * weighted cost — Cloudflare describes it as intentionally not an accounting
 * system. That is fine for a request count and useless for a path budget, where
 * one request may cost a thousand times another. This object carries the cost.
 *
 * Keyed on a verified Firebase uid, never an IP: the zone WAF rule is the coarse
 * pre-authentication shield, and application quotas only run after identity.
 */
export interface QuotaDecision {
  success: boolean;
  /** Epoch milliseconds at which the window resets. */
  reset: number;
  remaining: number;
}

interface WindowState {
  used: number;
  reset: number;
}

export class QuotaCounter extends DurableObject {
  async consume(key: string, cost: number, limit: number, windowMs: number): Promise<QuotaDecision> {
    const now = Date.now();
    const stored = await this.ctx.storage.get<WindowState>(key);
    const window: WindowState = stored && stored.reset > now
      ? stored
      : { used: 0, reset: now + windowMs };

    // A single request larger than the whole budget can never succeed; reject
    // it without consuming the window, so it cannot starve smaller requests.
    if (cost > limit) {
      return { success: false, reset: window.reset, remaining: limit - window.used };
    }

    if (window.used + cost > limit) {
      return { success: false, reset: window.reset, remaining: limit - window.used };
    }

    window.used += cost;
    await this.ctx.storage.put(key, window);
    // Storage is durable but the window is disposable; let it expire rather
    // than accumulate a row per key forever.
    await this.ctx.storage.setAlarm(window.reset);
    return { success: true, reset: window.reset, remaining: limit - window.used };
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const entries = await this.ctx.storage.list<WindowState>();
    for (const [key, window] of entries) {
      if (window.reset <= now) await this.ctx.storage.delete(key);
    }
  }
}
