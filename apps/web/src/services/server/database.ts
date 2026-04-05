/**
 * Unified database service with abstraction layer for SQLite/Postgres compatibility.
 * Handles all persistent data: accounts and user profiles.
 * Designed for easy migration from SQLite to Postgres.
 */

import type {
  Account,
  CreateAccountData,
} from '@/domain/types';

// Database abstraction layer interfaces
export interface DatabaseConnection {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  queryOne<T = any>(sql: string, params?: any[]): Promise<T | null>;
  execute(sql: string, params?: any[]): Promise<void>;
  executeMany(sql: string, paramsList: any[][]): Promise<void>;
  transaction<T>(callback: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface DatabaseMigration {
  version: number;
  name: string;
  up: string[];
  down: string[];
}

// Unified database service interface
export interface UnifiedDatabaseService {
  // Core database operations
  initialize(): Promise<void>;
  close(): Promise<void>;
  migrate(): Promise<void>;
  getDatabaseInfo(): Promise<{
    type: 'sqlite' | 'postgres';
    version: number;
    sizeMB?: number;
    location: string;
  }>;

  // Raw query access (for complex queries)
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;

  // User Profile Settings
  getUserProfile(userId: string): Promise<{ profile: Record<string, unknown>; socialSecurity: Record<string, unknown>; assumptions: Record<string, unknown> } | null>;
  saveUserProfile(userId: string, data: { profile: Record<string, unknown>; socialSecurity: Record<string, unknown>; assumptions: Record<string, unknown> }): Promise<void>;

  // Accounts
  createAccount(data: CreateAccountData): Promise<Account>;
  getAccounts(): Promise<Account[]>;
  getAccount(id: string): Promise<Account | null>;
  updateAccount(id: string, updates: Partial<Omit<Account, 'id' | 'createdAt' | 'updatedAt' | 'taxable'>>): Promise<Account>;
  deleteAccount(id: string): Promise<void>;

  // OCR Feedback
  saveOcrFeedback(feedback: {
    imagePath: string;
    targetSchema: Record<string, unknown>;
    gatekeeperOutput: Record<string, unknown>;
    extractorOutput: Record<string, unknown>;
    auditorOutput: Record<string, unknown>;
    correctedData: Record<string, unknown>;
    userFeedback: 'APPROVED' | 'CORRECTED';
  }): Promise<void>;
}

// Database migrations
export const DATABASE_MIGRATIONS: DatabaseMigration[] = [
  {
    version: 1,
    name: 'Initial schema',
    up: [
      `CREATE TABLE IF NOT EXISTS individual_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        institution TEXT NOT NULL,
        account_type TEXT NOT NULL,
        fallback_stocks_weight REAL,
        fallback_bonds_weight REAL,
        is_active BOOLEAN DEFAULT TRUE,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      `CREATE TABLE IF NOT EXISTS account_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL REFERENCES individual_accounts(id) ON DELETE CASCADE,
        balance REAL NOT NULL,
        snapshot_date DATE NOT NULL,
        stocks_weight REAL NOT NULL,
        bonds_weight REAL NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(account_id, snapshot_date)
      )`,

      `CREATE TABLE IF NOT EXISTS catch_up_calculations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        snapshot_id UUID NOT NULL REFERENCES account_snapshots(id) ON DELETE CASCADE,
        target_date DATE NOT NULL,
        final_balance REAL NOT NULL,
        stocks_return REAL NOT NULL,
        bonds_return REAL NOT NULL,
        total_return REAL NOT NULL,
        methodology TEXT NOT NULL,
        calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      `CREATE TABLE IF NOT EXISTS security_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL REFERENCES individual_accounts(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL,
        shares REAL NOT NULL,
        transaction_date DATE NOT NULL,
        transaction_type TEXT NOT NULL,
        price_per_share REAL,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      `CREATE TABLE IF NOT EXISTS historical_prices (
        id SERIAL PRIMARY KEY,
        symbol TEXT NOT NULL,
        date DATE NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume BIGINT NOT NULL,
        source TEXT NOT NULL DEFAULT 'polygon',
        fetched_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(symbol, date)
      )`,

      `CREATE TABLE IF NOT EXISTS current_prices (
        id SERIAL PRIMARY KEY,
        symbol TEXT NOT NULL UNIQUE,
        price REAL NOT NULL,
        market_status TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'polygon',
        fetched_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      // Indexes for performance
      `CREATE INDEX IF NOT EXISTS idx_snapshots_account_date ON account_snapshots(account_id, snapshot_date)`,
      `CREATE INDEX IF NOT EXISTS idx_transactions_account_symbol ON security_transactions(account_id, symbol)`,
      `CREATE INDEX IF NOT EXISTS idx_transactions_date ON security_transactions(transaction_date)`,
      `CREATE INDEX IF NOT EXISTS idx_historical_symbol_date ON historical_prices(symbol, date)`,
      `CREATE INDEX IF NOT EXISTS idx_historical_date ON historical_prices(date)`,
      `CREATE INDEX IF NOT EXISTS idx_current_symbol ON current_prices(symbol)`,
    ],
    down: [
      'DROP TABLE IF EXISTS current_prices',
      'DROP TABLE IF EXISTS historical_prices',
      'DROP TABLE IF EXISTS security_transactions',
      'DROP TABLE IF EXISTS catch_up_calculations',
      'DROP TABLE IF EXISTS account_snapshots',
      'DROP TABLE IF EXISTS individual_accounts',
    ],
  },
  {
    version: 2,
    name: 'Add holdings snapshots cache',
    up: [
      `CREATE TABLE IF NOT EXISTS holdings_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL REFERENCES individual_accounts(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL,
        shares REAL NOT NULL,
        average_cost_basis REAL NOT NULL,
        as_of_date DATE NOT NULL,
        last_transaction_id UUID REFERENCES security_transactions(id),
        calculation_method TEXT NOT NULL DEFAULT 'full_calc',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(account_id, symbol, as_of_date)
      )`,

      // Indexes for fast lookups (using IF NOT EXISTS)
      `CREATE INDEX IF NOT EXISTS idx_holdings_account_date ON holdings_snapshots(account_id, as_of_date DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_holdings_symbol_date ON holdings_snapshots(symbol, as_of_date DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_holdings_account_symbol ON holdings_snapshots(account_id, symbol, as_of_date DESC)`,
    ],
    down: [
      'DROP TABLE IF EXISTS holdings_snapshots',
    ],
  },
  {
    version: 3,
    name: 'Unified account architecture',
    up: [
      // Create new unified accounts table
      `CREATE TABLE IF NOT EXISTS accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        institution TEXT NOT NULL,
        account_type TEXT NOT NULL CHECK (account_type IN ('Taxable', 'Traditional', 'Roth', 'HSA')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      // Create new unified account_transactions table
      `CREATE TABLE IF NOT EXISTS account_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL,
        transaction_type TEXT NOT NULL CHECK (transaction_type IN ('BUY', 'SELL', 'SPLIT', 'DIVIDEND_REINVEST')),
        shares DECIMAL(15,6) NOT NULL,
        price_per_share DECIMAL(10,2),
        transaction_date DATE NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      // Add indexes for performance
      `CREATE INDEX IF NOT EXISTS idx_account_transactions_account_id ON account_transactions(account_id)`,
      `CREATE INDEX IF NOT EXISTS idx_account_transactions_symbol ON account_transactions(symbol)`,
      `CREATE INDEX IF NOT EXISTS idx_account_transactions_date ON account_transactions(transaction_date)`,
      `CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(account_type)`,

      // Migrate data from individual_accounts to accounts
      `INSERT INTO accounts (id, name, institution, account_type, created_at, updated_at)
       SELECT id, name, institution, account_type, created_at, NOW()
       FROM individual_accounts
       ON CONFLICT (id) DO NOTHING`,

      // Migrate data from security_transactions to account_transactions
      `INSERT INTO account_transactions (id, account_id, symbol, transaction_type, shares, price_per_share, transaction_date, description, created_at)
       SELECT id, account_id, symbol, transaction_type, shares, price_per_share, transaction_date, description, created_at
       FROM security_transactions
       ON CONFLICT (id) DO NOTHING`,
    ],
    down: [
      'DROP INDEX IF EXISTS idx_accounts_type',
      'DROP INDEX IF EXISTS idx_account_transactions_date',
      'DROP INDEX IF EXISTS idx_account_transactions_symbol',
      'DROP INDEX IF EXISTS idx_account_transactions_account_id',
      'DROP TABLE IF EXISTS account_transactions',
      'DROP TABLE IF EXISTS accounts',
    ],
  },
  {
    version: 4,
    name: 'OCR feedback and training data',
    up: [
      `CREATE TABLE IF NOT EXISTS ocr_feedback (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        image_path TEXT NOT NULL,
        target_schema JSONB NOT NULL,
        gatekeeper_output JSONB NOT NULL,
        extractor_output JSONB NOT NULL,
        auditor_output JSONB NOT NULL,
        corrected_data JSONB NOT NULL,
        user_feedback TEXT NOT NULL CHECK (user_feedback IN ('APPROVED', 'CORRECTED'))
      )`,

      // Index for querying by feedback type and date
      `CREATE INDEX IF NOT EXISTS idx_ocr_feedback_type_date ON ocr_feedback(user_feedback, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_ocr_feedback_created ON ocr_feedback(created_at DESC)`,
    ],
    down: [
      'DROP INDEX IF EXISTS idx_ocr_feedback_created',
      'DROP INDEX IF NOT EXISTS idx_ocr_feedback_type_date',
      'DROP TABLE IF EXISTS ocr_feedback',
    ],
  },
  {
    version: 5,
    name: 'Complete unified account architecture cleanup',
    up: [
      // Drop deprecated tables (CASCADE removes dependent constraints automatically)
      `DROP TABLE IF EXISTS catch_up_calculations CASCADE`,
      `DROP TABLE IF EXISTS account_snapshots CASCADE`,
      `DROP TABLE IF EXISTS security_transactions CASCADE`,
      `DROP TABLE IF EXISTS individual_accounts CASCADE`,

      // Update holdings_snapshots foreign key to reference accounts table
      `ALTER TABLE holdings_snapshots DROP CONSTRAINT IF EXISTS holdings_snapshots_account_id_fkey`,
      `ALTER TABLE holdings_snapshots ADD CONSTRAINT holdings_snapshots_account_id_fkey
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE`,
    ],
    down: [
      // Recreate individual_accounts table
      `CREATE TABLE IF NOT EXISTS individual_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        institution TEXT NOT NULL,
        account_type TEXT NOT NULL,
        fallback_stocks_weight REAL,
        fallback_bonds_weight REAL,
        is_active BOOLEAN DEFAULT TRUE,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      // Recreate account_snapshots
      `CREATE TABLE IF NOT EXISTS account_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL REFERENCES individual_accounts(id) ON DELETE CASCADE,
        balance REAL NOT NULL,
        snapshot_date DATE NOT NULL,
        stocks_weight REAL NOT NULL,
        bonds_weight REAL NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(account_id, snapshot_date)
      )`,

      // Recreate catch_up_calculations
      `CREATE TABLE IF NOT EXISTS catch_up_calculations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        snapshot_id UUID NOT NULL REFERENCES account_snapshots(id) ON DELETE CASCADE,
        target_date DATE NOT NULL,
        final_balance REAL NOT NULL,
        stocks_return REAL NOT NULL,
        bonds_return REAL NOT NULL,
        total_return REAL NOT NULL,
        methodology TEXT NOT NULL,
        calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      // Recreate security_transactions
      `CREATE TABLE IF NOT EXISTS security_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL REFERENCES individual_accounts(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL,
        shares REAL NOT NULL,
        transaction_date DATE NOT NULL,
        transaction_type TEXT NOT NULL,
        price_per_share REAL,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      // Restore foreign keys
      `ALTER TABLE holdings_snapshots DROP CONSTRAINT IF EXISTS holdings_snapshots_account_id_fkey`,
      `ALTER TABLE holdings_snapshots ADD CONSTRAINT holdings_snapshots_account_id_fkey
        FOREIGN KEY (account_id) REFERENCES individual_accounts(id) ON DELETE CASCADE`,
    ],
  },
  {
    version: 6,
    name: 'Add authentication tables for NextAuth.js',
    up: [
      // Users table
      `CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT,
        email TEXT UNIQUE NOT NULL,
        email_verified TIMESTAMPTZ,
        image TEXT,
        password_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      // Sessions table
      `CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_token TEXT UNIQUE NOT NULL,
        expires TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      // Verification tokens table (for email verification, password reset, etc.)
      `CREATE TABLE IF NOT EXISTS verification_tokens (
        identifier TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (identifier, token)
      )`,

      // Add indexes for performance
      `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token)`,

      // Add user_id to accounts table for multi-user support
      `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE`,
      `CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id)`,
    ],
    down: [
      'DROP INDEX IF EXISTS idx_accounts_user_id',
      'ALTER TABLE accounts DROP COLUMN IF EXISTS user_id',
      'DROP INDEX IF EXISTS idx_sessions_token',
      'DROP INDEX IF EXISTS idx_sessions_user_id',
      'DROP INDEX IF EXISTS idx_users_email',
      'DROP TABLE IF EXISTS verification_tokens',
      'DROP TABLE IF EXISTS sessions',
      'DROP TABLE IF EXISTS users',
    ],
  },
  {
    version: 7,
    name: 'Migrate from NextAuth to Firebase Authentication',
    up: [
      // Add firebase_uid column to users table
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid TEXT UNIQUE`,

      // Create index for firebase_uid for fast lookups
      `CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid)`,

      // Make password_hash nullable since Firebase handles password authentication
      `ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`,

      // Drop NextAuth sessions and verification_tokens tables (no longer needed with Firebase)
      `DROP TABLE IF EXISTS sessions CASCADE`,
      `DROP TABLE IF EXISTS verification_tokens CASCADE`,
    ],
    down: [
      // Recreate sessions table
      `CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_token TEXT UNIQUE NOT NULL,
        expires TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      // Recreate verification_tokens table
      `CREATE TABLE IF NOT EXISTS verification_tokens (
        identifier TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (identifier, token)
      )`,

      // Recreate indexes
      `CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token)`,

      // Drop firebase_uid column and its index
      `DROP INDEX IF EXISTS idx_users_firebase_uid`,
      `ALTER TABLE users DROP COLUMN IF EXISTS firebase_uid`,
    ],
  },
  {
    version: 8,
    name: 'Add balance and allocation columns to accounts',
    up: [
      `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS balance REAL NOT NULL DEFAULT 0`,
      `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS stocks_pct REAL NOT NULL DEFAULT 0`,
      `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS bonds_pct REAL NOT NULL DEFAULT 0`,
      `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS balance_as_of DATE`,
    ],
    down: [
      `ALTER TABLE accounts DROP COLUMN IF EXISTS balance_as_of`,
      `ALTER TABLE accounts DROP COLUMN IF EXISTS bonds_pct`,
      `ALTER TABLE accounts DROP COLUMN IF EXISTS stocks_pct`,
      `ALTER TABLE accounts DROP COLUMN IF EXISTS balance`,
    ],
  },
  {
    version: 9,
    name: 'Add user_profiles table for planning settings',
    up: [
      `CREATE TABLE IF NOT EXISTS user_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        profile JSONB NOT NULL DEFAULT '{}',
        social_security JSONB NOT NULL DEFAULT '{}',
        assumptions JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id)`,
    ],
    down: [
      'DROP INDEX IF EXISTS idx_user_profiles_user_id',
      'DROP TABLE IF EXISTS user_profiles',
    ],
  },
  {
    version: 10,
    name: 'Use Firebase UID as users primary key',
    up: [
      // Drop foreign keys first
      `ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_user_id_fkey`,
      `ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_user_id_fkey`,

      // Add new TEXT id column populated from firebase_uid
      `ALTER TABLE users ADD COLUMN new_id TEXT`,
      `UPDATE users SET new_id = firebase_uid WHERE firebase_uid IS NOT NULL`,
      `UPDATE users SET new_id = id::TEXT WHERE firebase_uid IS NULL`,

      // Update FK columns in child tables to reference the new TEXT id
      `ALTER TABLE accounts ADD COLUMN new_user_id TEXT`,
      `UPDATE accounts SET new_user_id = (SELECT new_id FROM users WHERE users.id = accounts.user_id)`,
      `ALTER TABLE accounts DROP COLUMN user_id`,
      `ALTER TABLE accounts RENAME COLUMN new_user_id TO user_id`,

      `ALTER TABLE user_profiles ADD COLUMN new_user_id TEXT`,
      `UPDATE user_profiles SET new_user_id = (SELECT new_id FROM users WHERE users.id = user_profiles.user_id)`,
      `ALTER TABLE user_profiles DROP COLUMN user_id`,
      `ALTER TABLE user_profiles RENAME COLUMN new_user_id TO user_id`,

      // Swap primary key on users
      `ALTER TABLE users DROP CONSTRAINT users_pkey`,
      `ALTER TABLE users DROP COLUMN id`,
      `ALTER TABLE users RENAME COLUMN new_id TO id`,
      `ALTER TABLE users ADD PRIMARY KEY (id)`,
      `ALTER TABLE users DROP COLUMN IF EXISTS firebase_uid`,
      `DROP INDEX IF EXISTS idx_users_firebase_uid`,

      // Re-add foreign keys as TEXT references
      `ALTER TABLE accounts ADD CONSTRAINT accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
      `ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
      `ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_user_id_key UNIQUE (user_id)`,

      // Drop legacy columns no longer needed
      `ALTER TABLE users DROP COLUMN IF EXISTS password_hash`,
      `ALTER TABLE users DROP COLUMN IF EXISTS email_verified`,
      `ALTER TABLE users DROP COLUMN IF EXISTS image`,
    ],
    down: [],
  },
];

// PostgreSQL implementation
import { Pool, PoolClient } from 'pg';

class PostgreSQLConnection implements DatabaseConnection {
  private pool: Pool;
  // When set, all operations use this client (inside a transaction)
  private transactionClient: PoolClient | null = null;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      // Connection pool settings optimized for Neon and cloud databases
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000, // Increased for Neon (wakeup time)
      // SSL is configured via the connection string (sslmode=require)
      // Neon pooler (PgBouncer transaction mode) handles SSL/TLS automatically
    });
  }

  private async getClient(): Promise<{ client: PoolClient; release: boolean }> {
    if (this.transactionClient) {
      return { client: this.transactionClient, release: false };
    }
    return { client: await this.pool.connect(), release: true };
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const { client, release } = await this.getClient();
    try {
      const result = await client.query(sql, params);
      return result.rows as T[];
    } finally {
      if (release) client.release();
    }
  }

  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const { client, release } = await this.getClient();
    try {
      const result = await client.query(sql, params);
      return result.rows[0] || null;
    } finally {
      if (release) client.release();
    }
  }

  async execute(sql: string, params: any[] = []): Promise<void> {
    const { client, release } = await this.getClient();
    try {
      await client.query(sql, params);
    } finally {
      if (release) client.release();
    }
  }

  async executeMany(sql: string, paramsList: any[][]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const params of paramsList) {
        await client.query(sql, params);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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

class PostgreSQLUnifiedDatabaseService implements UnifiedDatabaseService {
  private connection: PostgreSQLConnection | null = null;
  private readonly connectionString: string;
  private currentVersion = 0;

  constructor() {
    // Use environment variable for database connection
    // Validation happens in lib/env.ts - will throw if not set
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'DATABASE_URL environment variable is required. ' +
        'Please set it in your .env.local file or environment.'
      );
    }
    this.connectionString = process.env.DATABASE_URL;
  }

  async initialize(): Promise<void> {
    // If already initialized, don't initialize again
    if (this.connection) {
      return;
    }

    try {
      // Initialize connection
      this.connection = new PostgreSQLConnection(this.connectionString);

      // Test connection
      await this.connection.query('SELECT 1');

      // Run migrations
      await this.migrate();

      console.log(`Database initialized with PostgreSQL connection: ${this.connectionString.replace(/\/\/.*@/, '//***@')}`);

    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }

  /**
   * Ensure database is initialized before any operation
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.connection) {
      await this.initialize();
    }
  }

  async migrate(): Promise<void> {
    await this.ensureInitialized();

    // Create migrations table if it doesn't exist
    await this.connection!.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Repair: if migration v8 is recorded but columns are missing (due to prior
    // broken transaction implementation), remove the record so it re-runs.
    const hasV8 = await this.connection!.queryOne<{ version: number }>(`
      SELECT version FROM schema_migrations WHERE version = 8
    `);
    if (hasV8) {
      const colCheck = await this.connection!.queryOne<{ exists: boolean }>(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'accounts' AND column_name = 'stocks_pct'
        ) as exists
      `);
      if (!colCheck?.exists) {
        console.log('Migration v8 recorded but columns missing — re-applying');
        await this.connection!.execute(`DELETE FROM schema_migrations WHERE version = 8`);
      }
    }

    // Get current version
    const versionResult = await this.connection!.queryOne<{ version: number }>(`
      SELECT MAX(version) as version FROM schema_migrations
    `);
    this.currentVersion = versionResult?.version || 0;

    // Apply pending migrations
    for (const migration of DATABASE_MIGRATIONS) {
      if (migration.version > this.currentVersion) {
        console.log(`Applying migration ${migration.version}: ${migration.name}`);

        await this.connection!.transaction(async () => {
          // Execute all up statements
          for (const sql of migration.up) {
            console.log(`Executing SQL: ${sql.substring(0, 100)}...`);
            await this.connection!.execute(sql);
          }

          // Record migration
          await this.connection!.execute(`
            INSERT INTO schema_migrations (version, name) VALUES ($1, $2)
          `, [migration.version, migration.name]);
        });

        this.currentVersion = migration.version;
      }
    }
  }

  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<{ rows: T[] }> {
    await this.ensureInitialized();
    const rows = await this.connection!.query<T>(sql, params);
    return { rows };
  }

  async getDatabaseInfo(): Promise<{
    type: 'sqlite' | 'postgres';
    version: number;
    sizeMB?: number;
    location: string;
  }> {
    let sizeMB: number | undefined;

    try {
      if (this.connection) {
        const result = await this.connection.queryOne<{ size: string }>(`
          SELECT pg_size_pretty(pg_database_size(current_database())) as size
        `);
        if (result?.size) {
          // Parse size string like "8.2 MB" to number
          const match = result.size.match(/^([\d.]+)\s*MB/);
          if (match) {
            sizeMB = parseFloat(match[1]);
          }
        }
      }
    } catch (error) {
      console.warn('Could not get database size:', error);
    }

    return {
      type: 'postgres',
      version: this.currentVersion,
      sizeMB,
      location: this.connectionString.replace(/\/\/.*@/, '//***@'),
    };
  }

  // === ACCOUNT METHODS ===
  async createAccount(data: CreateAccountData): Promise<Account> {
    await this.ensureInitialized();

    const balance = data.balance ?? 0;
    const stocksWeight = data.stocksPct ?? 0;
    const bondsWeight = data.bondsPct ?? 0;

    const result = await this.connection!.queryOne<{ id: string }>(`
      INSERT INTO accounts (name, institution, account_type, balance, stocks_pct, bonds_pct)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [data.name, data.institution, data.type, balance, stocksWeight, bondsWeight]);

    if (!result?.id) throw new Error('Failed to create account');

    const account = await this.getAccount(result.id);
    if (!account) throw new Error('Failed to create account');
    return account;
  }

  async getAccounts(): Promise<Account[]> {
    await this.ensureInitialized();

    const rows = await this.connection!.query<any>(`
      SELECT * FROM accounts
      ORDER BY created_at DESC
    `);

    return rows.map(this.mapRowToAccount.bind(this));
  }

  async getAccount(id: string): Promise<Account | null> {
    await this.ensureInitialized();

    const row = await this.connection!.queryOne<any>(`
      SELECT * FROM accounts WHERE id = $1
    `, [id]);

    return row ? this.mapRowToAccount(row) : null;
  }

  async updateAccount(id: string, updates: Partial<Omit<Account, 'id' | 'createdAt' | 'updatedAt' | 'taxable'>>): Promise<Account> {
    await this.ensureInitialized();

    const updateFields: string[] = [];
    const updateValues: any[] = [];
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

    updateFields.push(`updated_at = $${paramIndex++}`);
    updateValues.push(new Date().toISOString());
    updateValues.push(id); // WHERE clause parameter

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

    await this.connection!.execute(`
      DELETE FROM accounts WHERE id = $1
    `, [id]);
  }

  // === USER PROFILE METHODS ===
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

  private mapRowToAccount(row: any): Account {
    return {
      id: row.id,
      name: row.name,
      institution: row.institution,
      type: row.account_type,
      user_id: row.user_id,
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

  async saveOcrFeedback(feedback: {
    imagePath: string;
    targetSchema: Record<string, unknown>;
    gatekeeperOutput: Record<string, unknown>;
    extractorOutput: Record<string, unknown>;
    auditorOutput: Record<string, unknown>;
    correctedData: Record<string, unknown>;
    userFeedback: 'APPROVED' | 'CORRECTED';
  }): Promise<void> {
    await this.ensureInitialized();

    await this.connection!.execute(`
      INSERT INTO ocr_feedback (
        image_path,
        target_schema,
        gatekeeper_output,
        extractor_output,
        auditor_output,
        corrected_data,
        user_feedback
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      feedback.imagePath,
      JSON.stringify(feedback.targetSchema),
      JSON.stringify(feedback.gatekeeperOutput),
      JSON.stringify(feedback.extractorOutput),
      JSON.stringify(feedback.auditorOutput),
      JSON.stringify(feedback.correctedData),
      feedback.userFeedback,
    ]);
  }
}

// Service factory
let unifiedDatabaseService: UnifiedDatabaseService | null = null;

export function getUnifiedDatabaseService(): UnifiedDatabaseService {
  if (!unifiedDatabaseService) {
    // Use PostgreSQL for all environments
    unifiedDatabaseService = new PostgreSQLUnifiedDatabaseService();
  }
  return unifiedDatabaseService;
}

export function setUnifiedDatabaseService(service: UnifiedDatabaseService): void {
  unifiedDatabaseService = service;
}

export function resetUnifiedDatabaseService(): void {
  unifiedDatabaseService = null;
}
