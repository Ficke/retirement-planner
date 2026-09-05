import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { monteCarloRequestSchema } from '@/lib/simulation-request';
import { PLAN_SCHEMA_VERSION } from '@/domain/constants';

/**
 * The deployed smoke checks send this, and it is the only assertion that a
 * released build can still answer a request shaped like the ones its own
 * clients send.
 *
 * Pinning the version inside the scripts was meant to be that assertion, and
 * could not be: every version below the current one is accepted so a rolling
 * deploy can serve older bundles, so a stale pin keeps passing against the
 * legacy branch while testing a contract nothing sends. The origin check sat
 * four bumps behind on exactly that. This runs before a deploy, where a
 * mismatch is a code error rather than a rollout state, so here it can be
 * strict.
 */
function smokePayload(): unknown {
  const built = execFileSync(
    'sh',
    ['-c', '. "$0/smoke-payload.sh" && printf %s "$PAYLOAD"', '../../scripts'],
    { env: { ...process.env, SMOKE_SCRIPT_DIR: '../../scripts' }, encoding: 'utf8' },
  );
  return JSON.parse(built);
}

describe('the smoke-check payload', () => {
  it('is built from the app-wide schema version', () => {
    const payload = smokePayload() as { plan: { schemaVersion: number } };
    expect(payload.plan.schemaVersion).toBe(PLAN_SCHEMA_VERSION);
  });

  it('validates on the current branch rather than the legacy one', () => {
    const parsed = monteCarloRequestSchema.safeParse(smokePayload());
    expect(parsed.success, JSON.stringify(parsed.error?.issues, null, 2)).toBe(true);
    // The legacy branch would have accepted it too, and silently — which is
    // the failure this test exists to make loud.
    expect(parsed.data!.plan.schemaVersion).toBe(PLAN_SCHEMA_VERSION);
  });

  it('exercises the settings a default plan actually carries', () => {
    const { plan } = monteCarloRequestSchema.parse(smokePayload());
    // A payload that opts out of the income-tested models tests a narrower
    // engine than any real client runs.
    expect(plan.profile.retirementHealthcare.preMedicarePremium).toBeGreaterThan(0);
    expect(plan.profile.longTermCare.enabled).toBe(true);
    expect(plan.assumptions.magiAwareWithdrawals).toBe(true);
    expect(plan.accounts.length).toBeGreaterThan(1);
  });
});
