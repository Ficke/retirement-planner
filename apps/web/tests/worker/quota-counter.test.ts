import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { QuotaCounter } from '@/worker/quota-counter';
import { durableObjectQuota } from '@/worker/quota-counter';

const MINUTE = { limit: 1000, windowMs: 60_000 };

function quota(shard: string) {
  return durableObjectQuota(env.QUOTA, shard);
}

describe('QuotaCounter', () => {
  it('spends a weighted budget and refuses what would exceed it', async () => {
    const limiter = quota('weighted');
    expect(await limiter.consume('uid-1', 800, MINUTE)).toMatchObject({
      success: true,
      remaining: 200,
    });
    // Refused, and the window is untouched so smaller requests still fit.
    expect(await limiter.consume('uid-1', 300, MINUTE)).toMatchObject({
      success: false,
      remaining: 200,
    });
    expect(await limiter.consume('uid-1', 200, MINUTE)).toMatchObject({
      success: true,
      remaining: 0,
    });
  });

  it('keeps identities independent', async () => {
    const limiter = quota('identities');
    await limiter.consume('uid-a', 1000, MINUTE);
    expect(await limiter.consume('uid-b', 1000, MINUTE)).toMatchObject({ success: true });
  });

  it('refuses a request larger than the whole budget without starving others', async () => {
    const limiter = quota('oversized');
    expect(await limiter.consume('uid-1', 5000, MINUTE)).toMatchObject({ success: false });
    expect(await limiter.consume('uid-1', 1000, MINUTE)).toMatchObject({ success: true });
  });

  it('opens a fresh window once the previous one expires', async () => {
    const limiter = quota('expiry');
    await limiter.consume('uid-1', 1000, { limit: 1000, windowMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await limiter.consume('uid-1', 1000, MINUTE)).toMatchObject({ success: true });
  });

  it('drops expired windows when the alarm fires', async () => {
    const stub = env.QUOTA.get(env.QUOTA.idFromName('alarm'));
    await durableObjectQuota(env.QUOTA, 'alarm')
      .consume('uid-1', 1, { limit: 1000, windowMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));

    await runInDurableObject(stub, async (instance: QuotaCounter, state) => {
      await instance.alarm();
      expect([...(await state.storage.list())]).toHaveLength(0);
    });
  });
});
