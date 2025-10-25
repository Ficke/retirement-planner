import { NextRequest, NextResponse } from 'next/server';
import { getUnifiedDatabaseService } from '@/services/server/database';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; snapshotId: string }> }
) {
  try {
    const { snapshotId } = await params;
    const db = getUnifiedDatabaseService();
    await db.initialize();
    const snapshot = await db.getSnapshot(snapshotId);

    if (!snapshot) {
      return NextResponse.json(
        { error: 'Snapshot not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(snapshot);
  } catch (error) {
    console.error('Get snapshot error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch snapshot' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; snapshotId: string }> }
) {
  try {
    const { snapshotId } = await params;
    const db = getUnifiedDatabaseService();
    await db.initialize();
    await db.deleteSnapshot(snapshotId);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Delete snapshot error:', error);
    return NextResponse.json(
      { error: 'Failed to delete snapshot' },
      { status: 500 }
    );
  }
}