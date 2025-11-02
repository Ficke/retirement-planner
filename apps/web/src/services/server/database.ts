/**
 * Unified database service with abstraction layer for SQLite/Postgres compatibility.
 * Handles all persistent data: accounts, snapshots, transactions, and historical prices.
 * Designed for easy migration from SQLite to Postgres.
 */

import type {
  Account,
  AccountSnapshot,
  CatchUpCalculation,
  CreateAccountData,
  CreateSnapshotData,
  AccountTransaction,
  CreateAccountTransactionData,
  TransactionType,
  HoldingsSnapshot,
  CreateHoldingsSnapshotData,
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

// Price data interfaces
export interface PriceRecord {
  id?: number;
  symbol: string;
  date: string; // YYYY-MM-DD format
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: 'polygon' | 'fallback' | 'manual' | 'yahoo-finance' | 'transaction';
  fetched_at: string; // ISO timestamp
  created_at?: string;
}

export interface CurrentPriceRecord {
  id?: number;
  symbol: string;
  price: number;
  market_status: 'open' | 'closed' | 'extended_hours';
  source: 'polygon' | 'fallback';
  fetched_at: string; // ISO timestamp
  created_at?: string;
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
  // User helpers
  getUserIdFromFirebaseUid(firebaseUid: string): Promise<string | null>;

  // Unified Accounts
  createAccount(data: CreateAccountData): Promise<Account>;
  getAccounts(): Promise<Account[]>;
  getAccount(id: string): Promise<Account | null>;
  updateAccount(id: string, updates: Partial<Omit<Account, 'id' | 'createdAt' | 'updatedAt' | 'balance' | 'assetWeights' | 'taxable'>>): Promise<Account>;
  deleteAccount(id: string): Promise<void>;

  // Account Transactions
  createAccountTransaction(data: CreateAccountTransactionData): Promise<AccountTransaction>;
  getAccountTransactions(accountId: string): Promise<AccountTransaction[]>;
  updateAccountTransaction(id: string, updates: Partial<Omit<AccountTransaction, 'id' | 'accountId' | 'createdAt'>>): Promise<AccountTransaction>;
  deleteAccountTransaction(id: string): Promise<void>;
  findDuplicateTransaction(accountId: string, symbol: string, shares: number, transactionDate: string, transactionType: string): Promise<AccountTransaction | null>;

  // Account Snapshots
  createSnapshot(data: CreateSnapshotData): Promise<AccountSnapshot>;
  getSnapshots(accountId?: string): Promise<AccountSnapshot[]>;
  getSnapshot(id: string): Promise<AccountSnapshot | null>;
  getLatestSnapshot(accountId: string): Promise<AccountSnapshot | null>;
  deleteSnapshot(id: string): Promise<void>;

  // Catch-up Calculations
  saveCatchUpCalculation(calculation: CatchUpCalculation): Promise<void>;
  getCatchUpCalculation(snapshotId: string): Promise<CatchUpCalculation | null>;

  // Holdings Snapshots Cache
  createHoldingsSnapshot(data: CreateHoldingsSnapshotData): Promise<HoldingsSnapshot>;
  getHoldingsSnapshots(accountId: string, asOfDate?: string): Promise<HoldingsSnapshot[]>;
  getLatestHoldingsSnapshots(accountId: string, beforeDate?: string): Promise<HoldingsSnapshot[]>;
  deleteHoldingsSnapshots(accountId: string, afterDate?: string): Promise<void>;

  // Historical Prices (permanent storage)
  insertHistoricalPrice(record: Omit<PriceRecord, 'id' | 'created_at'>): Promise<void>;
  insertHistoricalPrices(records: Omit<PriceRecord, 'id' | 'created_at'>[]): Promise<void>;
  getHistoricalPrice(symbol: string, date: string): Promise<PriceRecord | null>;
  getHistoricalPriceRange(symbol: string, startDate: string, endDate: string): Promise<PriceRecord[]>;
  hasHistoricalPrice(symbol: string, date: string): Promise<boolean>;

  // Current Prices (frequently updated)
  insertCurrentPrice(record: Omit<CurrentPriceRecord, 'id' | 'created_at'>): Promise<void>;
  getCurrentPrice(symbol: string): Promise<CurrentPriceRecord | null>;
  getCurrentPrices(symbols: string[]): Promise<Record<string, CurrentPriceRecord>>;

  // Analytics and Stats
  getDatabaseStats(): Promise<{
    accountCount: number;
    snapshotCount: number;
    transactionCount: number;
    historicalPriceCount: number;
    currentPriceCount: number;
    uniqueSymbols: string[];
    dateRange: { earliest: string; latest: string } | null;
  }>;

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
];

// PostgreSQL implementation
import { Pool, PoolClient } from 'pg';

class PostgreSQLConnection implements DatabaseConnection {
  private pool: Pool;

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

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows as T[];
    } finally {
      client.release();
    }
  }

  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  async execute(sql: string, params: any[] = []): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(sql, params);
    } finally {
      client.release();
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
      const result = await callback();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

class PostgreSQLUnifiedDatabaseService implements UnifiedDatabaseService {
  private connection: PostgreSQLConnection | null = null;
  private currentVersion = 0;

  constructor() {
    // Lazy initialization - don't validate DATABASE_URL until actually needed
  }
  
  private getConnectionString(): string {
    // Lazy validation - only check when actually connecting
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'DATABASE_URL environment variable is required. ' +
        'Please set it in your .env.local file or environment.'
      );
    }
    return process.env.DATABASE_URL;
  }

  async initialize(): Promise<void> {
    // If already initialized, don't initialize again
    if (this.connection) {
      return;
    }

    try {
      // Initialize connection
      const connectionString = this.getConnectionString();
      this.connection = new PostgreSQLConnection(connectionString);

      // Test connection
      await this.connection.query('SELECT 1');

      // Run migrations
      await this.migrate();

      console.log(`Database initialized with PostgreSQL connection: ${connectionString.replace(/\/\/.*@/, '//***@')}`);

      // Log stats
      const stats = await this.getDatabaseStats();
      console.log('Database stats:', stats);

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
      location: this.getConnectionString().replace(/\/\/.*@/, '//***@'),
    };
  }

  // === USER HELPER METHODS ===
  
  /**
   * Get database user ID from Firebase UID
   * Helper for transitioning from database user lookup to Firebase-only auth
   */
  async getUserIdFromFirebaseUid(firebaseUid: string): Promise<string | null> {
    await this.ensureInitialized();
    
    const result = await this.query<{ id: string }>(
      'SELECT id FROM users WHERE firebase_uid = $1',
      [firebaseUid]
    );
    
    return result.rows.length > 0 ? result.rows[0].id : null;
  }

  // === UNIFIED ACCOUNT METHODS (accounts table) ===
  async createAccount(data: CreateAccountData): Promise<Account> {
    await this.ensureInitialized();

    const result = await this.connection!.queryOne<{ id: string }>(`
      INSERT INTO accounts (name, institution, account_type)
      VALUES ($1, $2, $3)
      RETURNING id
    `, [data.name, data.institution, data.type]);

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

  async updateAccount(id: string, updates: Partial<Omit<Account, 'id' | 'createdAt' | 'updatedAt' | 'balance' | 'assetWeights' | 'taxable'>>): Promise<Account> {
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

  // Account Transactions implementation
  async createAccountTransaction(data: CreateAccountTransactionData): Promise<AccountTransaction> {
    await this.ensureInitialized();

    const result = await this.connection!.queryOne<{ id: string }>(`
      INSERT INTO account_transactions (
        account_id, symbol, transaction_type, shares, price_per_share, transaction_date, description
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [
      data.accountId,
      data.symbol.toUpperCase(),
      data.transactionType,
      data.shares,
      data.pricePerShare ?? null,
      data.transactionDate,
      data.description ?? null,
    ]);

    const transaction = await this.connection!.queryOne<any>(`
      SELECT * FROM account_transactions WHERE id = $1
    `, [result!.id]);

    return this.mapRowToAccountTransaction(transaction!);
  }

  async getAccountTransactions(accountId: string): Promise<AccountTransaction[]> {
    await this.ensureInitialized();

    const rows = await this.connection!.query<any>(`
      SELECT * FROM account_transactions
      WHERE account_id = $1
      ORDER BY transaction_date DESC, created_at DESC
    `, [accountId]);

    return rows.map(row => this.mapRowToAccountTransaction(row));
  }

  async updateAccountTransaction(
    id: string,
    updates: Partial<Omit<AccountTransaction, 'id' | 'accountId' | 'createdAt'>>
  ): Promise<AccountTransaction> {
    await this.ensureInitialized();

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.symbol !== undefined) {
      setClauses.push(`symbol = $${paramIndex++}`);
      values.push(updates.symbol.toUpperCase());
    }
    if (updates.transactionType !== undefined) {
      setClauses.push(`transaction_type = $${paramIndex++}`);
      values.push(updates.transactionType);
    }
    if (updates.shares !== undefined) {
      setClauses.push(`shares = $${paramIndex++}`);
      values.push(updates.shares);
    }
    if (updates.pricePerShare !== undefined) {
      setClauses.push(`price_per_share = $${paramIndex++}`);
      values.push(updates.pricePerShare);
    }
    if (updates.transactionDate !== undefined) {
      setClauses.push(`transaction_date = $${paramIndex++}`);
      values.push(updates.transactionDate);
    }
    if (updates.description !== undefined) {
      setClauses.push(`description = $${paramIndex++}`);
      values.push(updates.description);
    }

    if (setClauses.length === 0) {
      throw new Error('No updates provided');
    }

    values.push(id);

    await this.connection!.execute(`
      UPDATE account_transactions
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
    `, values);

    const transaction = await this.connection!.queryOne<any>(`
      SELECT * FROM account_transactions WHERE id = $1
    `, [id]);

    if (!transaction) {
      throw new Error('Transaction not found after update');
    }

    return this.mapRowToAccountTransaction(transaction);
  }

  async deleteAccountTransaction(id: string): Promise<void> {
    await this.ensureInitialized();

    await this.connection!.execute(`
      DELETE FROM account_transactions WHERE id = $1
    `, [id]);
  }

  async findDuplicateTransaction(
    accountId: string,
    symbol: string,
    shares: number,
    transactionDate: string,
    transactionType: string
  ): Promise<AccountTransaction | null> {
    await this.ensureInitialized();

    // Look for transactions with exact same key fields
    // Allow for small floating point differences in shares (within 0.0001)
    const row = await this.connection!.queryOne<any>(`
      SELECT * FROM account_transactions
      WHERE account_id = $1
        AND symbol = $2
        AND transaction_type = $3
        AND transaction_date = $4
        AND ABS(shares - $5) < 0.0001
      ORDER BY created_at DESC
      LIMIT 1
    `, [accountId, symbol.toUpperCase(), transactionType, transactionDate, shares]);

    if (!row) {
      return null;
    }

    return this.mapRowToAccountTransaction(row);
  }

  // Helper method to map database row to AccountTransaction
  private mapRowToAccountTransaction(row: any): AccountTransaction {
    return {
      id: row.id,
      accountId: row.account_id,
      symbol: row.symbol,
      transactionType: row.transaction_type as TransactionType,
      shares: parseFloat(row.shares),
      pricePerShare: row.price_per_share ? parseFloat(row.price_per_share) : undefined,
      transactionDate: row.transaction_date,
      description: row.description ?? undefined,
      createdAt: row.created_at,
    };
  }

  // Helper method to map database row to unified Account
  private mapRowToAccount(row: any): Account {
    // TODO: Calculate balance and assetWeights from transactions
    // For now, return with default values
    return {
      id: row.id,
      name: row.name,
      institution: row.institution,
      type: row.account_type,
      user_id: row.user_id, // Owner of this account (for multi-user support)
      balance: 0, // TODO: Calculate from account_transactions
      assetWeights: { stocks: 0.6, bonds: 0.4 }, // TODO: Calculate from holdings
      taxable: row.account_type === 'Taxable',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // Account Snapshots implementation (DEPRECATED - will be removed in migration 5)
  async createSnapshot(data: CreateSnapshotData): Promise<AccountSnapshot> {
    await this.ensureInitialized();

    const result = await this.connection!.queryOne<{ id: string }>(`
      INSERT INTO account_snapshots (
        account_id, balance, snapshot_date, stocks_weight, bonds_weight
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [
      data.accountId,
      data.balance,
      data.snapshotDate,
      data.stocksWeight,
      data.bondsWeight,
    ]);

    if (!result?.id) throw new Error('Failed to create snapshot');

    const snapshot = await this.getSnapshot(result.id);
    if (!snapshot) throw new Error('Failed to create snapshot');
    return snapshot;
  }

  async getSnapshots(accountId?: string): Promise<AccountSnapshot[]> {
    await this.ensureInitialized();

    const sql = accountId
      ? 'SELECT * FROM account_snapshots WHERE account_id = $1 ORDER BY snapshot_date DESC'
      : 'SELECT * FROM account_snapshots ORDER BY snapshot_date DESC';

    const params = accountId ? [accountId] : [];
    const rows = await this.connection!.query<any>(sql, params);

    return rows.map(this.mapRowToAccountSnapshot);
  }

  async getSnapshot(id: string): Promise<AccountSnapshot | null> {
    await this.ensureInitialized();

    const row = await this.connection!.queryOne<any>(`
      SELECT * FROM account_snapshots WHERE id = $1
    `, [id]);

    return row ? this.mapRowToAccountSnapshot(row) : null;
  }

  async getLatestSnapshot(accountId: string): Promise<AccountSnapshot | null> {
    await this.ensureInitialized();

    const row = await this.connection!.queryOne<any>(`
      SELECT * FROM account_snapshots
      WHERE account_id = $1
      ORDER BY snapshot_date DESC
      LIMIT 1
    `, [accountId]);

    return row ? this.mapRowToAccountSnapshot(row) : null;
  }

  async deleteSnapshot(id: string): Promise<void> {
    await this.ensureInitialized();

    await this.connection!.execute(`DELETE FROM account_snapshots WHERE id = $1`, [id]);
  }

  // Holdings Snapshots - Smart caching for holdings-based single source of truth
  async createHoldingsSnapshot(data: CreateHoldingsSnapshotData): Promise<HoldingsSnapshot> {
    await this.ensureInitialized();

    const result = await this.connection!.queryOne<any>(`
      INSERT INTO holdings_snapshots (
        account_id, symbol, shares, average_cost_basis, as_of_date,
        last_transaction_id, calculation_method
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      data.accountId,
      data.symbol,
      data.shares,
      data.averageCostBasis,
      data.asOfDate,
      data.lastTransactionId || null,
      data.calculationMethod || 'full_calc'
    ]);

    if (!result) {
      throw new Error('Failed to create holdings snapshot');
    }

    return this.mapRowToHoldingsSnapshot(result);
  }

  async getHoldingsSnapshots(accountId: string, asOfDate?: string): Promise<HoldingsSnapshot[]> {
    await this.ensureInitialized();

    let query = `
      SELECT * FROM holdings_snapshots
      WHERE account_id = $1
    `;
    const params: any[] = [accountId];

    if (asOfDate) {
      query += ` AND as_of_date = $2`;
      params.push(asOfDate);
    }

    query += ` ORDER BY symbol, as_of_date DESC`;

    const rows = await this.connection!.query<any>(query, params);
    return rows.map(row => this.mapRowToHoldingsSnapshot(row));
  }

  async getLatestHoldingsSnapshots(accountId: string, beforeDate?: string): Promise<HoldingsSnapshot[]> {
    await this.ensureInitialized();

    let query = `
      SELECT DISTINCT ON (symbol) *
      FROM holdings_snapshots
      WHERE account_id = $1
    `;
    const params: any[] = [accountId];

    if (beforeDate) {
      query += ` AND as_of_date <= $2`;
      params.push(beforeDate);
    }

    query += ` ORDER BY symbol, as_of_date DESC`;

    const rows = await this.connection!.query<any>(query, params);
    return rows.map(row => this.mapRowToHoldingsSnapshot(row));
  }

  async deleteHoldingsSnapshots(accountId: string, symbol?: string): Promise<void> {
    await this.ensureInitialized();

    let query = `DELETE FROM holdings_snapshots WHERE account_id = $1`;
    const params: any[] = [accountId];

    if (symbol) {
      query += ` AND symbol = $2`;
      params.push(symbol);
    }

    await this.connection!.execute(query, params);
  }

  private mapRowToHoldingsSnapshot(row: any): HoldingsSnapshot {
    return {
      id: row.id,
      accountId: row.account_id,
      symbol: row.symbol,
      shares: row.shares,
      averageCostBasis: row.average_cost_basis,
      asOfDate: row.as_of_date,
      lastTransactionId: row.last_transaction_id,
      calculationMethod: row.calculation_method,
      createdAt: row.created_at,
    };
  }

  private mapRowToAccountSnapshot(row: any): AccountSnapshot {
    return {
      id: row.id,
      accountId: row.account_id,
      balance: row.balance,
      snapshotDate: row.snapshot_date,
      stocksWeight: row.stocks_weight,
      bondsWeight: row.bonds_weight,
      createdAt: row.created_at,
    };
  }

  async saveCatchUpCalculation(calculation: CatchUpCalculation): Promise<void> {
    throw new Error('Not implemented yet');
  }

  async getCatchUpCalculation(snapshotId: string): Promise<CatchUpCalculation | null> {
    throw new Error('Not implemented yet');
  }

  // Historical Prices implementation - the core of our growing price database
  async insertHistoricalPrice(record: Omit<PriceRecord, 'id' | 'created_at'>): Promise<void> {
    await this.ensureInitialized();

    await this.connection!.execute(`
      INSERT INTO historical_prices (
        symbol, date, open, high, low, close, volume, source, fetched_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (symbol, date) DO UPDATE SET
        open = EXCLUDED.open,
        high = EXCLUDED.high,
        low = EXCLUDED.low,
        close = EXCLUDED.close,
        volume = EXCLUDED.volume,
        source = EXCLUDED.source,
        fetched_at = EXCLUDED.fetched_at
    `, [
      record.symbol.toUpperCase(),
      record.date,
      record.open,
      record.high,
      record.low,
      record.close,
      record.volume,
      record.source,
      record.fetched_at,
    ]);
  }

  async insertHistoricalPrices(records: Omit<PriceRecord, 'id' | 'created_at'>[]): Promise<void> {
    await this.ensureInitialized();
    if (records.length === 0) return;

    const params = records.map(record => [
      record.symbol.toUpperCase(),
      record.date,
      record.open,
      record.high,
      record.low,
      record.close,
      record.volume,
      record.source,
      record.fetched_at,
    ]);

    await this.connection!.executeMany(`
      INSERT INTO historical_prices (
        symbol, date, open, high, low, close, volume, source, fetched_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (symbol, date) DO UPDATE SET
        open = EXCLUDED.open,
        high = EXCLUDED.high,
        low = EXCLUDED.low,
        close = EXCLUDED.close,
        volume = EXCLUDED.volume,
        source = EXCLUDED.source,
        fetched_at = EXCLUDED.fetched_at
    `, params);

    console.log(`✅ Stored ${records.length} historical price records in database`);
  }

  async getHistoricalPrice(symbol: string, date: string): Promise<PriceRecord | null> {
    await this.ensureInitialized();

    const row = await this.connection!.queryOne<any>(`
      SELECT * FROM historical_prices
      WHERE symbol = $1 AND date = $2
    `, [symbol.toUpperCase(), date]);

    return row ? this.mapRowToPriceRecord(row) : null;
  }

  async getHistoricalPriceRange(symbol: string, startDate: string, endDate: string): Promise<PriceRecord[]> {
    await this.ensureInitialized();

    const rows = await this.connection!.query<any>(`
      SELECT * FROM historical_prices
      WHERE symbol = $1 AND date >= $2 AND date <= $3
      ORDER BY date ASC
    `, [symbol.toUpperCase(), startDate, endDate]);

    return rows.map(this.mapRowToPriceRecord);
  }

  async hasHistoricalPrice(symbol: string, date: string): Promise<boolean> {
    await this.ensureInitialized();

    const result = await this.connection!.queryOne<{ exists: number }>(`
      SELECT 1 as exists FROM historical_prices
      WHERE symbol = $1 AND date = $2
      LIMIT 1
    `, [symbol.toUpperCase(), date]);

    return !!result?.exists;
  }

  // Current Prices implementation - frequently updated latest prices
  async insertCurrentPrice(record: Omit<CurrentPriceRecord, 'id' | 'created_at'>): Promise<void> {
    await this.ensureInitialized();

    await this.connection!.execute(`
      INSERT INTO current_prices (
        symbol, price, market_status, source, fetched_at
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (symbol) DO UPDATE SET
        price = EXCLUDED.price,
        market_status = EXCLUDED.market_status,
        source = EXCLUDED.source,
        fetched_at = EXCLUDED.fetched_at
    `, [
      record.symbol.toUpperCase(),
      record.price,
      record.market_status,
      record.source,
      record.fetched_at,
    ]);
  }

  async getCurrentPrice(symbol: string): Promise<CurrentPriceRecord | null> {
    await this.ensureInitialized();

    const row = await this.connection!.queryOne<any>(`
      SELECT * FROM current_prices WHERE symbol = $1
    `, [symbol.toUpperCase()]);

    return row ? this.mapRowToCurrentPriceRecord(row) : null;
  }

  async getCurrentPrices(symbols: string[]): Promise<Record<string, CurrentPriceRecord>> {
    await this.ensureInitialized();
    if (symbols.length === 0) return {};

    const placeholders = symbols.map(() => '?').join(',');
    const rows = await this.connection!.query<any>(`
      SELECT * FROM current_prices
      WHERE symbol IN (${placeholders})
    `, symbols.map(s => s.toUpperCase()));

    const result: Record<string, CurrentPriceRecord> = {};
    for (const row of rows) {
      const record = this.mapRowToCurrentPriceRecord(row);
      result[record.symbol] = record;
    }

    return result;
  }

  private mapRowToPriceRecord(row: any): PriceRecord {
    return {
      id: row.id,
      symbol: row.symbol,
      date: row.date,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
      source: row.source,
      fetched_at: row.fetched_at,
      created_at: row.created_at,
    };
  }

  private mapRowToCurrentPriceRecord(row: any): CurrentPriceRecord {
    return {
      id: row.id,
      symbol: row.symbol,
      price: row.price,
      market_status: row.market_status,
      source: row.source,
      fetched_at: row.fetched_at,
      created_at: row.created_at,
    };
  }

  async getDatabaseStats(): Promise<{
    accountCount: number;
    snapshotCount: number;
    transactionCount: number;
    historicalPriceCount: number;
    currentPriceCount: number;
    uniqueSymbols: string[];
    dateRange: { earliest: string; latest: string } | null;
  }> {
    await this.ensureInitialized();

    const [
      accountCount,
      transactionCount,
      historicalPriceCount,
      currentPriceCount,
    ] = await Promise.all([
      this.connection!.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM accounts'),
      this.connection!.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM account_transactions'),
      this.connection!.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM historical_prices'),
      this.connection!.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM current_prices'),
    ]);

    const symbolsResult = await this.connection!.query<{ symbol: string }>(`
      SELECT DISTINCT symbol FROM (
        SELECT symbol FROM account_transactions
        UNION
        SELECT symbol FROM historical_prices
        UNION
        SELECT symbol FROM current_prices
      ) ORDER BY symbol
    `);

    const dateRangeResult = await this.connection!.queryOne<{ earliest: string | null; latest: string | null }>(`
      SELECT MIN(date) as earliest, MAX(date) as latest
      FROM historical_prices
    `);

    return {
      accountCount: accountCount?.count || 0,
      snapshotCount: 0, // Deprecated - snapshots removed
      transactionCount: transactionCount?.count || 0,
      historicalPriceCount: historicalPriceCount?.count || 0,
      currentPriceCount: currentPriceCount?.count || 0,
      uniqueSymbols: symbolsResult.map(r => r.symbol),
      dateRange: dateRangeResult?.earliest && dateRangeResult?.latest
        ? { earliest: dateRangeResult.earliest, latest: dateRangeResult.latest }
        : null,
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