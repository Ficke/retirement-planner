import { DurableObject } from 'cloudflare:workers';
import type { Budget, QuotaDecision } from '@/api/quota';

interface WindowState {
  used: number;
  reset: number;
}

/**
 * An exact, globally consistent quota over a fixed window.
 *
 * The Workers rate-limit binding cannot do this job: it is per-colo, eventually
 * consistent, and has no weighted cost, which Cloudflare states plainly. That
 * is adequate for counting requests and useless for a path budget, where one
 * request can cost a thousand times another.
 *
 * Callers key on a verified identity, never an IP. The zone WAF rule is the
 * coarse pre-authentication shield; this runs after identity is established.
 */
export class QuotaCounter extends DurableObject {
  async consume(key: string, cost: number, budget: Budget): Promise<QuotaDecision> {
    const now = Date.now();
    const stored = await this.ctx.storage.get<WindowState>(key);
    const window: WindowState = stored && stored.reset > now
      ? stored
      : { used: 0, reset: now + budget.windowMs };

    // Nothing is spent on a refusal, so an oversized request cannot starve the
    // window for smaller ones; it simply never succeeds.
    const refused = window.used + cost > budget.limit;
    if (refused) {
      return { success: false, reset: window.reset, remaining: budget.limit - window.used };
    }

    const next: WindowState = { used: window.used + cost, reset: window.reset };
    await this.ctx.storage.put(key, next);
    // Windows are disposable; expire them rather than keep a row per key.
    await this.ctx.storage.setAlarm(next.reset);
    return { success: true, reset: next.reset, remaining: budget.limit - next.used };
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    for (const [key, window] of await this.ctx.storage.list<WindowState>()) {
      if (window.reset <= now) await this.ctx.storage.delete(key);
    }
  }
}

/**
 * Adapt a QuotaCounter namespace to the shared limiter interface.
 *
 * `shard` selects the object, so unrelated budgets do not serialize behind one
 * another; keys within a shard stay independent.
 */
export function durableObjectQuota(
  namespace: DurableObjectNamespace<QuotaCounter>,
  shard: string,
) {
  return {
    consume(key: string, cost: number, budget: Budget): Promise<QuotaDecision> {
      return namespace.get(namespace.idFromName(shard)).consume(key, cost, budget);
    },
  };
}
