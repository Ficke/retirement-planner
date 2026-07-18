import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/firebase/server';
import { getUnifiedDatabaseService } from '@/services/server/database';
import { UpdateAccountSchema, validateRequest } from '@/lib/validation';
import type { Account } from '@/domain/types';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const db = getUnifiedDatabaseService();
    await db.initialize();
    const account = await db.getAccount(id);

    if (!account) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      );
    }

    // Verify account belongs to user
    if (account.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json(account);
  } catch (error) {
    console.error('Get account error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch account' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const db = getUnifiedDatabaseService();
    await db.initialize();

    // Verify account belongs to user before updating
    const existingAccount = await db.getAccount(id);
    if (!existingAccount || existingAccount.user_id !== user.id) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const body = await request.json();
    const validation = validateRequest(UpdateAccountSchema, body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', errors: validation.errors },
        { status: 400 }
      );
    }

    const updates = validation.data as Partial<Omit<Account, 'id' | 'createdAt'>>;
    const account = await db.updateAccount(id, updates);

    return NextResponse.json(account);
  } catch (error) {
    console.error('Update account error:', error);
    return NextResponse.json(
      { error: 'Failed to update account' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const db = getUnifiedDatabaseService();
    await db.initialize();

    // Verify account belongs to user before deleting
    const existingAccount = await db.getAccount(id);
    if (!existingAccount || existingAccount.user_id !== user.id) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    await db.deleteAccount(id);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Delete account error:', error);
    return NextResponse.json(
      { error: 'Failed to delete account' },
      { status: 500 }
    );
  }
}