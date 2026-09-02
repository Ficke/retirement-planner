import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AccountLimitError,
  ProfileRevisionConflictError,
  type UnifiedDatabaseService,
} from '@/services/server/database';
import { getUnifiedDatabaseService } from '@/services/server/database-pool';
import { applyMigrations } from '@/services/server/migrate';

const enabled = process.env.RUN_DATABASE_INTEGRATION === 'true'
  && Boolean(process.env.DATABASE_URL);

const users = {
  owner: 'ci-owner',
  other: 'ci-other',
  limited: 'ci-limited',
};

describe.skipIf(!enabled)('Postgres cloud persistence', () => {
  let db: UnifiedDatabaseService;

  beforeAll(async () => {
    // Migrations no longer run on first use, so the suite applies them the
    // way CI does before the Worker deploys.
    const migrator = new Client({ connectionString: process.env.DATABASE_URL });
    await migrator.connect();
    await applyMigrations(migrator);
    await migrator.end();

    db = getUnifiedDatabaseService();
    await db.query('DELETE FROM users WHERE id = ANY($1::text[])', [Object.values(users)]);
    for (const id of Object.values(users)) {
      await db.query(
        'INSERT INTO users (id, email) VALUES ($1, $2)',
        [id, `${id}@example.test`],
      );
    }
  });

  afterAll(async () => {
    await db.query('DELETE FROM users WHERE id = ANY($1::text[])', [Object.values(users)]);
  });

  it('applies the complete migration chain on a fresh database', async () => {
    const result = await db.query<{ version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    expect(result.rows.map(({ version }) => version)).toEqual([10, 11, 12, 13, 14]);
  });

  it('rounds balances to financial precision and isolates account owners', async () => {
    const account = await db.createAccount({
      name: 'Owner brokerage',
      institution: 'Test',
      type: 'Taxable',
      balance: 123.456,
      stocksPct: 0.6,
      bondsPct: 0.4,
    }, users.owner);

    expect(account.balance).toBe(123.46);
    expect(await db.getAccount(account.id, users.other)).toBeNull();
    expect(await db.updateAccount(account.id, users.other, { balance: 999 })).toBeNull();
    expect(await db.deleteAccount(account.id, users.other)).toBe(false);
    expect((await db.getAccount(account.id, users.owner))?.balance).toBe(123.46);
  });

  it('enforces allocation constraints in the database', async () => {
    await expect(db.createAccount({
      name: 'Invalid allocation',
      institution: 'Test',
      type: 'Traditional',
      balance: 1_000,
      stocksPct: 0.8,
      bondsPct: 0.8,
    }, users.owner)).rejects.toThrow();
  });

  it('serializes concurrent creates at the account limit', async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 21 }, (_, index) => db.createAccount({
        name: `Concurrent ${index}`,
        institution: 'Test',
        type: 'Taxable',
        balance: index,
        stocksPct: 0.6,
        bondsPct: 0.4,
      }, users.limited)),
    );

    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(fulfilled).toHaveLength(20);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(AccountLimitError);
  }, 15_000);

  it('rejects stale cloud profile revisions', async () => {
    const data = {
      profile: { age: 45 },
      socialSecurity: { enabled: true },
      assumptions: { simulationModel: 'historical' },
    };

    expect(await db.saveUserProfile(users.other, data, null)).toBe(0);
    expect(await db.saveUserProfile(users.other, { ...data, profile: { age: 46 } }, 0)).toBe(1);
    await expect(db.saveUserProfile(users.other, data, 0))
      .rejects.toBeInstanceOf(ProfileRevisionConflictError);
  });
});
