/**
 * PostgreSQL database service.
 * Live schema: users, accounts, user_profiles.
 *
 * Migration strategy: production databases recorded versions 1-10 from earlier
 * architectures (holdings, transactions, OCR). Version 10 is the compact
 * baseline for fresh databases (idempotent CREATE IF NOT EXISTS), and
 * version 11 drops the legacy tables everywhere.
 */

import type { Account, CreateAccountData, UpdateAccountData } from '@/domain/types';
import { MAX_PLAN_ACCOUNTS, PLAN_SCHEMA_VERSION } from '@/domain/constants';

export interface DatabaseMigration {
  version: number;
  name: string;
  up: string[];
}

/**
 * A connection able to run single statements. Both a pooled Cloud Run
 * connection and a per-request Worker client satisfy it.
 */
export interface SqlExecutor {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = unknown>(sql: string, params?: unknown[]): Promise<T | null>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export interface SqlConnection extends SqlExecutor {
  transaction<T>(run: (transaction: SqlExecutor) => Promise<T>): Promise<T>;
}

export interface UnifiedDatabaseService {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;

  getUserProfile(userId: string): Promise<{ profile: Record<string, unknown>; socialSecurity: Record<string, unknown>; assumptions: Record<string, unknown>; revision: number; schemaVersion: number } | null>;
  saveUserProfile(userId: string, data: { profile: Record<string, unknown>; socialSecurity: Record<string, unknown>; assumptions: Record<string, unknown> }, expectedRevision: number | null): Promise<number>;

  createAccount(data: CreateAccountData, userId: string): Promise<Account>;
  getAccount(id: string, userId: string): Promise<Account | null>;
  getAccountsForUser(userId: string): Promise<Account[]>;
  updateAccount(id: string, userId: string, updates: UpdateAccountData): Promise<Account | null>;
  deleteAccount(id: string, userId: string): Promise<boolean>;
}

export const DATABASE_MIGRATIONS: DatabaseMigration[] = [
  {
    version: 10,
    name: 'Baseline schema: users, accounts, user_profiles',
    up: [
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT UNIQUE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        institution TEXT NOT NULL,
        account_type TEXT NOT NULL CHECK (account_type IN ('Taxable', 'Traditional', 'Roth', 'HSA')),
        balance REAL NOT NULL DEFAULT 0,
        stocks_pct REAL NOT NULL DEFAULT 0,
        bonds_pct REAL NOT NULL DEFAULT 0,
        balance_as_of DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id)`,
      `CREATE TABLE IF NOT EXISTS user_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        profile JSONB NOT NULL DEFAULT '{}',
        social_security JSONB NOT NULL DEFAULT '{}',
        assumptions JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id)`,
    ],
  },
  {
    version: 11,
    name: 'Drop legacy tables from retired features',
    up: [
      `DROP TABLE IF EXISTS holdings_snapshots CASCADE`,
      `DROP TABLE IF EXISTS account_transactions CASCADE`,
      `DROP TABLE IF EXISTS ocr_feedback CASCADE`,
      `DROP TABLE IF EXISTS historical_prices CASCADE`,
      `DROP TABLE IF EXISTS current_prices CASCADE`,
      `DROP TABLE IF EXISTS sessions CASCADE`,
      `DROP TABLE IF EXISTS verification_tokens CASCADE`,
    ],
  },
  {
    version: 12,
    name: 'Use financial precision and enforce account invariants',
    up: [
      `ALTER TABLE accounts
         ALTER COLUMN balance TYPE NUMERIC(18, 2) USING ROUND(balance::numeric, 2),
         ALTER COLUMN balance SET DEFAULT 0,
         ALTER COLUMN stocks_pct TYPE NUMERIC(8, 7) USING stocks_pct::numeric,
         ALTER COLUMN bonds_pct TYPE NUMERIC(8, 7) USING bonds_pct::numeric`,
      `ALTER TABLE accounts
         ADD CONSTRAINT accounts_balance_nonnegative CHECK (balance >= 0) NOT VALID`,
      `ALTER TABLE accounts
         ADD CONSTRAINT accounts_allocations_valid CHECK (
           stocks_pct BETWEEN 0 AND 1
           AND bonds_pct BETWEEN 0 AND 1
           AND ABS(stocks_pct + bonds_pct - 1) <= 0.000001
         ) NOT VALID`,
      `ALTER TABLE accounts
         ADD CONSTRAINT accounts_user_required CHECK (user_id IS NOT NULL) NOT VALID`,
    ],
  },
  {
    version: 13,
    name: 'Add optimistic revision to cloud profiles',
    up: [
      `ALTER TABLE user_profiles
         ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0`,
    ],
  },
  {
    version: 14,
    name: 'Version persisted cloud profiles',
    up: [
      `ALTER TABLE user_profiles
         ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE user_profiles
         ALTER COLUMN schema_version SET DEFAULT ${PLAN_SCHEMA_VERSION}`,
    ],
  },
];

/**
 * The schema the running code expects. A Worker isolate checks the deployed
 * database against this once and refuses to serve below it, which catches a
 * deploy that skipped the migration step in CI.
 */
export const REQUIRED_SCHEMA_VERSION = Math.max(
  ...DATABASE_MIGRATIONS.map((migration) => migration.version),
);

export class SchemaFloorError extends Error {
  constructor(readonly deployedVersion: number) {
    super(
      `Database schema is at version ${deployedVersion}, below the required ` +
      `${REQUIRED_SCHEMA_VERSION}. Run migrations before serving.`,
    );
    this.name = 'SchemaFloorError';
  }
}

export class ProfileRevisionConflictError extends Error {
  constructor() {
    super('Cloud profile changed since it was loaded');
    this.name = 'ProfileRevisionConflictError';
  }
}

export class AccountLimitError extends Error {
  constructor() {
    super(`A plan may contain at most ${MAX_PLAN_ACCOUNTS} accounts`);
    this.name = 'AccountLimitError';
  }
}

interface AccountRow {
  id: string;
  name: string;
  institution: string;
  account_type: Account['type'];
  balance: string | number;
  stocks_pct: string | number;
  bonds_pct: string | number;
}

class PostgreSQLUnifiedDatabaseService implements UnifiedDatabaseService {
  constructor(private readonly connection: SqlConnection) {}

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    const rows = await this.connection.query<T>(sql, params);
    return { rows };
  }

  // === ACCOUNTS ===

  async createAccount(data: CreateAccountData, userId: string): Promise<Account> {
    const stocksPct = data.stocksPct ?? 0.6;
    const bondsPct = data.bondsPct ?? 1 - stocksPct;

    const row = await this.connection.transaction(async (transaction) => {
      // Serialize creates for one owner so concurrent requests cannot race
      // past the product/resource limit.
      await transaction.execute('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `retirement-plan-accounts:${userId}`,
      ]);
      const count = await transaction.queryOne<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM accounts WHERE user_id = $1',
        [userId],
      );
      if (Number(count?.count ?? 0) >= MAX_PLAN_ACCOUNTS) {
        throw new AccountLimitError();
      }
      return transaction.queryOne<AccountRow>(`
        INSERT INTO accounts (name, institution, account_type, balance, stocks_pct, bonds_pct, user_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `, [data.name, data.institution, data.type, data.balance ?? 0, stocksPct, bondsPct, userId]);
    });

    if (!row) throw new Error('Failed to create account');
    return mapRowToAccount(row);
  }

  async getAccount(id: string, userId: string): Promise<Account | null> {
    const row = await this.connection.queryOne<AccountRow>(
      `SELECT * FROM accounts WHERE id = $1 AND user_id = $2`, [id, userId],
    );
    return row ? mapRowToAccount(row) : null;
  }

  async getAccountsForUser(userId: string): Promise<Account[]> {
    const rows = await this.connection.query<AccountRow>(
      `SELECT * FROM accounts WHERE user_id = $1 ORDER BY created_at DESC`, [userId],
    );
    return rows.map(mapRowToAccount);
  }

  async updateAccount(id: string, userId: string, updates: UpdateAccountData): Promise<Account | null> {

    const updateFields: string[] = [];
    const updateValues: unknown[] = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      updateFields.push(`name = $${paramIndex++}`);
      updateValues.push(updates.name);
    }
    if (updates.institution !== undefined) {
      updateFields.push(`institution = $${paramIndex++}`);
      updateValues.push(updates.institution);
    }
    if (updates.type !== undefined) {
      updateFields.push(`account_type = $${paramIndex++}`);
      updateValues.push(updates.type);
    }
    if (updates.balance !== undefined) {
      updateFields.push(`balance = $${paramIndex++}`);
      updateValues.push(updates.balance);
    }
    if (updates.assetWeights !== undefined) {
      updateFields.push(`stocks_pct = $${paramIndex++}`);
      updateValues.push(updates.assetWeights.stocks);
      updateFields.push(`bonds_pct = $${paramIndex++}`);
      updateValues.push(updates.assetWeights.bonds);
    }
    if (updateFields.length === 0) {
      return this.getAccount(id, userId);
    }

    updateFields.push(`updated_at = NOW()`);
    updateValues.push(id);
    updateValues.push(userId);

    const row = await this.connection.queryOne<AccountRow>(`
      UPDATE accounts
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex++} AND user_id = $${paramIndex}
      RETURNING *
    `, updateValues);
    return row ? mapRowToAccount(row) : null;
  }

  async deleteAccount(id: string, userId: string): Promise<boolean> {
    const row = await this.connection.queryOne<{ id: string }>(
      `DELETE FROM accounts WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, userId],
    );
    return row !== null;
  }

  // === USER PROFILES ===

  async getUserProfile(userId: string): Promise<{ profile: Record<string, unknown>; socialSecurity: Record<string, unknown>; assumptions: Record<string, unknown>; revision: number; schemaVersion: number } | null> {

    const row = await this.connection.queryOne<{
      profile: Record<string, unknown>;
      social_security: Record<string, unknown>;
      assumptions: Record<string, unknown>;
      revision: string | number;
      schema_version: string | number;
    }>(`
      SELECT profile, social_security, assumptions, revision, schema_version
      FROM user_profiles WHERE user_id = $1
    `, [userId]);

    if (!row) return null;

    return {
      profile: row.profile,
      socialSecurity: row.social_security,
      assumptions: row.assumptions,
      revision: Number(row.revision),
      schemaVersion: Number(row.schema_version),
    };
  }

  async saveUserProfile(
    userId: string,
    data: { profile: Record<string, unknown>; socialSecurity: Record<string, unknown>; assumptions: Record<string, unknown> },
    expectedRevision: number | null,
  ): Promise<number> {

    const values = [
      userId,
      JSON.stringify(data.profile),
      JSON.stringify(data.socialSecurity),
      JSON.stringify(data.assumptions),
    ];
    const row = expectedRevision === null
      ? await this.connection.queryOne<{ revision: string | number }>(`
          INSERT INTO user_profiles (user_id, profile, social_security, assumptions, schema_version)
          VALUES ($1, $2, $3, $4, ${PLAN_SCHEMA_VERSION})
          ON CONFLICT (user_id) DO NOTHING
          RETURNING revision
        `, values)
      : await this.connection.queryOne<{ revision: string | number }>(`
          UPDATE user_profiles
          SET profile = $2,
              social_security = $3,
              assumptions = $4,
              schema_version = ${PLAN_SCHEMA_VERSION},
              revision = revision + 1,
              updated_at = NOW()
          WHERE user_id = $1 AND revision = $5
          RETURNING revision
        `, [...values, expectedRevision]);

    if (!row) throw new ProfileRevisionConflictError();
    return Number(row.revision);
  }
}

function mapRowToAccount(row: AccountRow): Account {
  const balance = Number(row.balance);
  const stocks = Number(row.stocks_pct);
  const bonds = Number(row.bonds_pct);
  if (![balance, stocks, bonds].every(Number.isFinite)) {
    throw new Error(`Invalid numeric account data for account ${row.id}`);
  }
  return {
    id: row.id,
    name: row.name,
    institution: row.institution,
    type: row.account_type,
    balance,
    assetWeights: {
      stocks,
      bonds,
    },
  };
}

/** Bind the data operations to a connection. Lifecycle belongs to the caller. */
export function createDatabaseService(connection: SqlConnection): UnifiedDatabaseService {
  return new PostgreSQLUnifiedDatabaseService(connection);
}
