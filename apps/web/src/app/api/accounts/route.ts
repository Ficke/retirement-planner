import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/firebase/server';
import { getUnifiedDatabaseService } from '@/services/server/database';
import { CreateAccountSchema, validateRequest } from '@/lib/validation';
import type { CreateAccountData } from '@/domain/types';

export async function GET() {
  try {
    const user = await getAuthUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const db = getUnifiedDatabaseService();
    await db.initialize();

    const result = await db.query(`
      SELECT * FROM accounts WHERE user_id = $1
    `, [user.id]);

    // Map raw database rows to Account objects with proper field mapping
    const accounts = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      institution: row.institution,
      type: row.account_type, // Map account_type to type
      user_id: row.user_id,
      balance: 0, // Will be calculated from holdings
      assetWeights: { stocks: 0.6, bonds: 0.4 }, // Default values
      taxable: row.account_type === 'Taxable',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return NextResponse.json(accounts);
  } catch (error) {
    console.error('Get accounts error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch accounts' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();

    // Validate input with Zod
    const validation = validateRequest(CreateAccountSchema, body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', errors: validation.errors },
        { status: 400 }
      );
    }

    const data = validation.data as CreateAccountData;

    const db = getUnifiedDatabaseService();
    await db.initialize();

    const account = await db.createAccount(data);

    // Assign account to logged-in user
    await db.query(
      'UPDATE accounts SET user_id = $1 WHERE id = $2',
      [user.id, account.id]
    );

    const updatedAccount = await db.getAccount(account.id);

    return NextResponse.json(updatedAccount, { status: 201 });
  } catch (error) {
    console.error('Create account error:', error);
    return NextResponse.json(
      { error: 'Failed to create account' },
      { status: 500 }
    );
  }
}