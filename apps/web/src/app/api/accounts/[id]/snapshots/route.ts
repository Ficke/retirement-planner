import { NextRequest, NextResponse } from 'next/server';
import { getUnifiedDatabaseService } from '@/services/server/database';
import type { CreateSnapshotData } from '@/domain/types';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getUnifiedDatabaseService();
    await db.initialize();
    const snapshots = await db.getSnapshots(id);

    return NextResponse.json(snapshots);
  } catch (error) {
    console.error('Get snapshots error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch snapshots' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data: Omit<CreateSnapshotData, 'accountId'> = await request.json();

    const db = getUnifiedDatabaseService();
    await db.initialize();
    const snapshot = await db.createSnapshot({
      ...data,
      accountId: id,
    });

    return NextResponse.json(snapshot, { status: 201 });
  } catch (error) {
    console.error('Create snapshot error:', error);
    return NextResponse.json(
      { error: 'Failed to create snapshot' },
      { status: 500 }
    );
  }
}