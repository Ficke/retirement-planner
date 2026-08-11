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

    if (!decodedToken.email) {
      return NextResponse.json(
        { error: 'Authenticated account has no email claim' },
        { status: 400 }
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
      [decodedToken.uid, decodedToken.email, decodedToken.name || null]
    );

    return NextResponse.json({
      success: true,
      userId: decodedToken.uid,
    });
  } catch (error) {
    console.error('Sync user error:', error);
    return NextResponse.json(
      { error: 'Failed to sync user' },
      { status: 500 }
    );
  }
}
