import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/firebase/server';
import { getUnifiedDatabaseService } from '@/services/server/database';
import {
  AccountIdSchema,
  readLimitedJson,
  UpdateAccountSchema,
  validateRequest,
} from '@/lib/validation';
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
    if (!AccountIdSchema.safeParse(id).success) {
      return NextResponse.json({ error: 'Invalid account ID' }, { status: 400 });
    }
    const db = getUnifiedDatabaseService();
    await db.initialize();
    const account = await db.getAccount(id, user.id);

    if (!account) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      );
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
    if (!AccountIdSchema.safeParse(id).success) {
      return NextResponse.json({ error: 'Invalid account ID' }, { status: 400 });
    }
    const db = getUnifiedDatabaseService();
    await db.initialize();

    const body = await readLimitedJson(request, 64 * 1024);
    const validation = validateRequest(UpdateAccountSchema, body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', errors: validation.errors },
        { status: 400 }
      );
    }

    const updates = validation.data as Partial<Omit<Account, 'id' | 'createdAt'>>;
    const account = await db.updateAccount(id, user.id, updates);
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    return NextResponse.json(account);
  } catch (error) {
    if (error instanceof RangeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }
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
    if (!AccountIdSchema.safeParse(id).success) {
      return NextResponse.json({ error: 'Invalid account ID' }, { status: 400 });
    }
    const db = getUnifiedDatabaseService();
    await db.initialize();

    const deleted = await db.deleteAccount(id, user.id);
    if (!deleted) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Delete account error:', error);
    return NextResponse.json(
      { error: 'Failed to delete account' },
      { status: 500 }
    );
  }
}
