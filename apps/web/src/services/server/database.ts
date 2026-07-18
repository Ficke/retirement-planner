/**
 * PostgreSQL database service.
 * Live schema: users, accounts, user_profiles.
 *
 * Migration strategy: production databases recorded versions 1-10 from earlier
 * architectures (holdings, transactions, OCR). Version 10 is the compact
 * baseline for fresh databases (idempotent CREATE IF NOT EXISTS), and
 * version 11 drops the legacy tables everywhere.
 */

import { Pool, PoolClient } from 'pg';
import type { Account, CreateAccountData } from '@/domain/types';

export interface DatabaseMigration {
  version: number;
  name: string;
  up: string[];
}

export interface UnifiedDatabaseService {
  initialize(): Promise<void>;
  close(): Promise<void>;
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;

  getUserProfile(userId: string): Promise<{ profile: Record<string, unknown>; socialSecurity: Record<string, unknown>; assumptions: Record<string, unknown> } | null>;
  saveUserProfile(userId: string, data: { profile: Record<string, unknown>; socialSecurity: Record<string, unknown>; assumptions: Record<string, unknown> }): Promise<void>;

  createAccount(data: CreateAccountData): Promise<Account>;
  getAccount(id: string): Promise<Account | null>;
  getAccountsForUser(userId: string): Promise<Account[]>;
  updateAccount(id: string, updates: Partial<Omit<Account, 'id' | 'createdAt' | 'updatedAt' | 'taxable'>>): Promise<Account>;
  deleteAccount(id: string): Promise<void>;
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
];

class PostgreSQLConnection {
  private pool: Pool;
  private transactionClient: PoolClient | null = null;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000, // Neon wakeup can be slow
    });
  }

  private async getClient(): Promise<{ client: PoolClient; release: boolean }> {
    if (this.transactionClient) {
      return { client: this.transactionClient, release: false };
    }
    return { client: await this.pool.connect(), release: true };
  }

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const { client, release } = await this.getClient();
    try {
      const result = await client.query(sql, params);
      return result.rows as T[];
    } finally {
      if (release) client.release();
    }
  }

  async queryOne<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    await this.query(sql, params);
  }

  async transaction<T>(callback: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      this.transactionClient = client;
      const result = await callback();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      this.transactionClient = null;
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

interface AccountRow {
  id: string;
  user_id: string | null;
  name: string;
  institution: string;
  account_type: Account['type'];
  balance: string | number;
  stocks_pct: string | number;
  bonds_pct: string | number;
  balance_as_of: string | null;
  created_at: string;
  updated_at: string;
}

class PostgreSQLUnifiedDatabaseService implements UnifiedDatabaseService {
  private connection: PostgreSQLConnection | null = null;
  private readonly connectionString: string;

  constructor() {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'DATABASE_URL environment variable is required. ' +
        'Please set it in your .env.local file or environment.'
      );
    }
    this.connectionString = process.env.DATABASE_URL;
  }

  async initialize(): Promise<void> {
    if (this.connection) return;

    this.connection = new PostgreSQLConnection(this.connectionString);
    await this.connection.query('SELECT 1');
    await this.migrate();
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.connection) {
      await this.initialize();
    }
  }

  private async migrate(): Promise<void> {
    await this.connection!.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const versionResult = await this.connection!.queryOne<{ version: number }>(`
      SELECT MAX(version) as version FROM schema_migrations
    `);
    let currentVersion = versionResult?.version || 0;

    for (const migration of DATABASE_MIGRATIONS) {
      if (migration.version > currentVersion) {
        console.log(`Applying migration ${migration.version}: ${migration.name}`);
        await this.connection!.transaction(async () => {
          for (const sql of migration.up) {
            await this.connection!.execute(sql);
          }
          await this.connection!.execute(
            `INSERT INTO schema_migrations (version, name) VALUES ($1, $2)`,
            [migration.version, migration.name],
          );
        });
        currentVersion = migration.version;
      }
    }
  }

  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }
  }

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    await this.ensureInitialized();
    const rows = await this.connection!.query<T>(sql, params);
    return { rows };
  }

  // === ACCOUNTS ===

  async createAccount(data: CreateAccountData): Promise<Account> {
    await this.ensureInitialized();

    const result = await this.connection!.queryOne<{ id: string }>(`
      INSERT INTO accounts (name, institution, account_type, balance, stocks_pct, bonds_pct, user_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [data.name, data.institution, data.type, data.balance ?? 0, data.stocksPct ?? 0, data.bondsPct ?? 0, data.userId ?? null]);

    if (!result?.id) throw new Error('Failed to create account');

    const account = await this.getAccount(result.id);
    if (!account) throw new Error('Failed to create account');
    return account;
  }

  async getAccount(id: string): Promise<Account | null> {
    await this.ensureInitialized();
    const row = await this.connection!.queryOne<AccountRow>(
      `SELECT * FROM accounts WHERE id = $1`, [id],
    );
    return row ? mapRowToAccount(row) : null;
  }

  async getAccountsForUser(userId: string): Promise<Account[]> {
    await this.ensureInitialized();
    const rows = await this.connection!.query<AccountRow>(
      `SELECT * FROM accounts WHERE user_id = $1 ORDER BY created_at DESC`, [userId],
    );
    return rows.map(mapRowToAccount);
  }

  async updateAccount(id: string, updates: Partial<Omit<Account, 'id' | 'createdAt' | 'updatedAt' | 'taxable'>>): Promise<Account> {
    await this.ensureInitialized();

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
    if (updates.balanceAsOf !== undefined) {
      updateFields.push(`balance_as_of = $${paramIndex++}`);
      updateValues.push(updates.balanceAsOf);
    }

    if (updateFields.length === 0) {
      const account = await this.getAccount(id);
      if (!account) throw new Error('Account not found');
      return account;
    }

    updateFields.push(`updated_at = NOW()`);
    updateValues.push(id);

    await this.connection!.execute(`
      UPDATE accounts
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
    `, updateValues);

    const account = await this.getAccount(id);
    if (!account) throw new Error('Account not found after update');
    return account;
  }

  async deleteAccount(id: string): Promise<void> {
    await this.ensureInitialized();
    await this.connection!.execute(`DELETE FROM accounts WHERE id = $1`, [id]);
  }

  // === USER PROFILES ===

  async getUserProfile(userId: string): Promise<{ profile: Record<string, unknown>; socialSecurity: Record<string, unknown>; assumptions: Record<string, unknown> } | null> {
    await this.ensureInitialized();

    const row = await this.connection!.queryOne<{
      profile: Record<string, unknown>;
      social_security: Record<string, unknown>;
      assumptions: Record<string, unknown>;
    }>(`
      SELECT profile, social_security, assumptions FROM user_profiles WHERE user_id = $1
    `, [userId]);

    if (!row) return null;

    return {
      profile: row.profile,
      socialSecurity: row.social_security,
      assumptions: row.assumptions,
    };
  }

  async saveUserProfile(userId: string, data: { profile: Record<string, unknown>; socialSecurity: Record<string, unknown>; assumptions: Record<string, unknown> }): Promise<void> {
    await this.ensureInitialized();

    await this.connection!.execute(`
      INSERT INTO user_profiles (user_id, profile, social_security, assumptions)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id) DO UPDATE SET
        profile = $2,
        social_security = $3,
        assumptions = $4,
        updated_at = NOW()
    `, [userId, JSON.stringify(data.profile), JSON.stringify(data.socialSecurity), JSON.stringify(data.assumptions)]);
  }
}

function mapRowToAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    institution: row.institution,
    type: row.account_type,
    user_id: row.user_id ?? undefined,
    balance: Number(row.balance) || 0,
    assetWeights: {
      stocks: Number(row.stocks_pct),
      bonds: Number(row.bonds_pct),
    },
    balanceAsOf: row.balance_as_of ?? undefined,
    taxable: row.account_type === 'Taxable',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

let unifiedDatabaseService: UnifiedDatabaseService | null = null;

export function getUnifiedDatabaseService(): UnifiedDatabaseService {
  if (!unifiedDatabaseService) {
    unifiedDatabaseService = new PostgreSQLUnifiedDatabaseService();
  }
  return unifiedDatabaseService;
}
