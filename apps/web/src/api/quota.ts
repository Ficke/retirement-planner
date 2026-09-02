/**
 * A consumable budget over a fixed window.
 *
 * Both callers weight their requests: a signup attempt costs one, a simulation
 * costs its path count. The two environments back this differently — an
 * in-process counter on Cloud Run, a Durable Object at the edge — but the
 * routes only ever see this interface.
 */
export interface Budget {
  limit: number;
  windowMs: number;
}

export interface QuotaDecision {
  success: boolean;
  /** Epoch milliseconds at which the window resets. */
  reset: number;
  remaining: number;
}

export interface QuotaLimiter {
  consume(key: string, cost: number, budget: Budget): Promise<QuotaDecision>;
}
