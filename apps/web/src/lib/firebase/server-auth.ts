/**
 * Server-Side Authentication Helpers
 * For use in API routes and Server Components
 */

import { headers } from 'next/headers';
import { verifyAuthToken } from './admin';

export interface AuthUser {
  id: string; // Firebase UID — matches users.id in the database
  email: string;
  name?: string | null;
}

/**
 * Get the authenticated user from the request
 * Checks the Authorization header for a Firebase ID token.
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
    const headersList = await headers();
    const authHeader = headersList.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return null;
    }

    // Verify token with Firebase Admin
    const decodedToken = await verifyAuthToken(authHeader);
    if (!decodedToken) {
      return null;
    }

    // Return user info directly from Firebase JWT - no database lookup needed
    // This eliminates circular dependency with database initialization
    return {
      id: decodedToken.uid,
      email: decodedToken.email || '',
      name: null,
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
