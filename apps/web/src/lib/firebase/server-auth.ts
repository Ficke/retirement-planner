/**
 * Server-Side Authentication Helpers
 * For use in API routes and Server Components
 * Replaces NextAuth's auth() function
 */

import { cookies, headers } from 'next/headers';
import { verifyAuthToken } from './admin';
import { getUnifiedDatabaseService } from '@/services/server/database';

export interface AuthUser {
  id: string; // PostgreSQL user ID
  firebaseUid: string; // Firebase UID
  email: string;
  name?: string | null;
}

/**
 * Get the authenticated user from the request
 * Checks both Authorization header and cookies for Firebase ID token
 * Returns user info from PostgreSQL database
 *
 * Usage in API routes:
 *   const user = await getAuthUser();
 *   if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 *
 * Usage in Server Components:
 *   const user = await getAuthUser();
 *   if (!user) redirect('/auth/signin');
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  try {
    // Get token from Authorization header or cookie
    const headersList = await headers();
    const authHeader = headersList.get('authorization');

    let token: string | null = null;

    // Try Authorization header first
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.split('Bearer ')[1];
    }

    // Try cookie as fallback
    if (!token) {
      const cookieStore = await cookies();
      token = cookieStore.get('firebase-token')?.value || null;
    }

    if (!token) {
      return null;
    }

    // Verify token with Firebase Admin
    // Note: verifyAuthToken expects "Bearer <token>" format
    const authHeaderValue = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    const decodedToken = await verifyAuthToken(authHeaderValue);
    if (!decodedToken) {
      return null;
    }

    // Get user from PostgreSQL database
    const db = getUnifiedDatabaseService();
    await db.initialize();

    const result = await db.query<{
      id: string;
      firebase_uid: string;
      email: string;
      name: string | null;
    }>(
      'SELECT id, firebase_uid, email, name FROM users WHERE firebase_uid = $1',
      [decodedToken.uid]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const user = result.rows[0];
    return {
      id: user.id,
      firebaseUid: user.firebase_uid,
      email: user.email,
      name: user.name,
    };
  } catch (error) {
    console.error('Error getting auth user:', error);
    return null;
  }
}

/**
 * Require authentication - throws error if not authenticated
 * Use this when you want to ensure a user is authenticated
 *
 * Usage:
 *   const user = await requireAuth();
 *   // user is guaranteed to be non-null here
 */
export async function requireAuth(): Promise<AuthUser> {
  const user = await getAuthUser();
  if (!user) {
    throw new Error('Unauthorized');
  }
  return user;
}
