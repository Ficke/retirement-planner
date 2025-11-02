/**
 * Server-Side Authentication Helpers
 * For use in API routes and Server Components
 * Replaces NextAuth's auth() function
 */

import { cookies, headers } from 'next/headers';
import { verifyAuthToken } from './admin';

export interface AuthUser {
  id: string; // Firebase UID (now primary ID)
  firebaseUid: string; // Firebase UID (same as id)
  email: string;
  name?: string | null;
}

/**
 * Get the authenticated user from the request
 * Checks both Authorization header and cookies for Firebase ID token
 * Returns user info directly from Firebase JWT (no database lookup)
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

    // Return user info directly from Firebase JWT - no database lookup needed
    // This eliminates circular dependency with database initialization
    return {
      id: decodedToken.uid,        // Firebase UID as primary ID
      firebaseUid: decodedToken.uid,
      email: decodedToken.email || '',
      name: decodedToken.name || null,
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
