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

    // Filter accounts by user_id
    const allAccounts = await db.getAccounts();
    const userAccounts = allAccounts.filter(account => account.user_id === user.id);

    return NextResponse.json(userAccounts);
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

    // Create account and assign to logged-in user
    const account = await db.createAccount(data);

    // Update account with user_id
    await db.query(
      'UPDATE accounts SET user_id = $1 WHERE id = $2',
      [user.id, account.id]
    );

    // Fetch and return updated account
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