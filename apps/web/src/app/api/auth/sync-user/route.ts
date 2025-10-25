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

    // Check if user already exists
    const existing = await db.query<{ id: string; firebase_uid: string }>(
      'SELECT id, firebase_uid FROM users WHERE firebase_uid = $1 OR email = $1',
      [firebaseUid, email]
    );

    let userId: string;

    if (existing.rows.length > 0) {
      // Update existing user
      const result = await db.query<{ id: string }>(
        `UPDATE users
         SET firebase_uid = $1, email = $2, name = $3, updated_at = NOW()
         WHERE id = $4
         RETURNING id`,
        [firebaseUid, email, name || null, existing.rows[0].id]
      );
      userId = result.rows[0].id;
    } else {
      // Create new user
      const result = await db.query<{ id: string }>(
        `INSERT INTO users (firebase_uid, email, name)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [firebaseUid, email, name || null]
      );
      userId = result.rows[0].id;
    }

    return NextResponse.json({
      success: true,
      userId,
    });
  } catch (error) {
    console.error('Sync user error:', error);
    return NextResponse.json(
      { error: 'Failed to sync user' },
      { status: 500 }
    );
  }
}
