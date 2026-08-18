/**
 * Sync Firebase user with PostgreSQL database
 * Creates or updates user record when they sign up or sign in
 *
 * Creating a row requires a signup invite code. Firebase itself will hand an
 * account to anyone holding the public web API key, so this route — the only
 * writer of `users` — is where signup is actually closed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken } from '@/lib/firebase/server';
import { INVITE_RATE_LIMIT, verifyInviteCode } from '@/lib/invite-code';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { getUnifiedDatabaseService } from '@/services/server/database';

async function readInviteCode(request: NextRequest): Promise<unknown> {
  try {
    const body = await request.json();
    return typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>).inviteCode
      : undefined;
  } catch {
    return undefined;
  }
}

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

    const inviteCode = await readInviteCode(request);

    const db = getUnifiedDatabaseService();
    await db.initialize();

    // Update-then-insert rather than an upsert: whether the row already exists
    // decides whether an invite code is required, and a single statement would
    // have created it before that question could be asked.
    const updated = await db.query(
      `UPDATE users SET email = $2, name = $3, updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [decodedToken.uid, decodedToken.email, decodedToken.name || null]
    );

    if (updated.rows.length === 0) {
      const ip = getClientIp(request.headers);
      const limited = await rateLimit(`invite:${ip}`, INVITE_RATE_LIMIT);
      if (!limited.success) {
        return NextResponse.json(
          { error: 'Too many signup attempts — try again later' },
          { status: 429, headers: { 'Retry-After': String(Math.ceil((limited.reset - Date.now()) / 1000)) } }
        );
      }

      if (!verifyInviteCode(inviteCode)) {
        return NextResponse.json(
          { error: 'That invite code is not valid' },
          { status: 403 }
        );
      }

      await db.query(
        `INSERT INTO users (id, email, name)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET
           email = $2, name = $3, updated_at = NOW()`,
        [decodedToken.uid, decodedToken.email, decodedToken.name || null]
      );
    }

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
