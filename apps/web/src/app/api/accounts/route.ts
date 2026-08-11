import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/firebase/server';
import { AccountLimitError, getUnifiedDatabaseService } from '@/services/server/database';
import { CreateAccountSchema, readLimitedJson, validateRequest } from '@/lib/validation';
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
    const accounts = await db.getAccountsForUser(user.id);

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

    const body = await readLimitedJson(request, 64 * 1024);

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

    const account = await db.createAccount({ ...data, userId: user.id });

    return NextResponse.json(account, { status: 201 });
  } catch (error) {
    if (error instanceof AccountLimitError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof RangeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }
    console.error('Create account error:', error);
    return NextResponse.json(
      { error: 'Failed to create account' },
      { status: 500 }
    );
  }
}
