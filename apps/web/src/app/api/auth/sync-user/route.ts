/**
 * Sync Firebase user with PostgreSQL database
 * Creates or updates user record when they sign up or sign in
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken } from '@/lib/firebase/server';
import { getUnifiedDatabaseService } from '@/services/server/database';

export async function POST(request: NextRequest) {
  try {
    // Verify Firebase token
    const authHeader = request.headers.get('authorization');
    const decodedToken = await verifyAuthToken(authHeader);

    if (!decodedToken) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { firebaseUid, email, name } = body;

    if (!firebaseUid || !email) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Verify the token matches the user being synced
    if (decodedToken.uid !== firebaseUid) {
      return NextResponse.json(
        { error: 'Token mismatch' },
        { status: 403 }
      );
    }

    const db = getUnifiedDatabaseService();
    await db.initialize();

    // Upsert user — Firebase UID is the primary key
    await db.query(
      `INSERT INTO users (id, email, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET
         email = $2, name = $3, updated_at = NOW()`,
      [firebaseUid, email, name || null]
    );

    return NextResponse.json({
      success: true,
      userId: firebaseUid,
    });
  } catch (error) {
    console.error('Sync user error:', error);
    return NextResponse.json(
      { error: 'Failed to sync user' },
      { status: 500 }
    );
  }
}
