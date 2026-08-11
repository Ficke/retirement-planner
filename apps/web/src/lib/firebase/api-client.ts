/**
 * Authenticated API Client
 * Automatically adds Firebase ID token to API requests
 */

import type { User } from 'firebase/auth';
import { auth } from './config';

/**
 * Wait for Firebase auth to be ready
 * Returns the current user or null if not authenticated
 */
async function waitForAuthReady(): Promise<User | null> {
  return new Promise((resolve) => {
    // Skip auth in test environment
    if (!auth) {
      resolve(null);
      return;
    }

    // If we already have a user, resolve immediately
    if (auth.currentUser) {
      resolve(auth.currentUser);
      return;
    }

    // Otherwise, wait for auth state to change
    const unsubscribe = auth.onAuthStateChanged((user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

/**
 * Make an authenticated API request
 * Automatically includes Firebase ID token in Authorization header
 *
 * Usage:
 *   const response = await authenticatedFetch('/api/accounts');
 *   const data = await response.json();
 */
export async function authenticatedFetch(
  url: string,
  options: RequestInit = {},
  expectedUserId?: string,
): Promise<Response> {
  // Wait for Firebase to initialize
  const user = await waitForAuthReady();

  if (!user) {
    throw new Error('Not authenticated');
  }
  if (expectedUserId && user.uid !== expectedUserId) {
    throw new Error('Authenticated account changed before the request was sent');
  }

  // Get fresh ID token
  const token = await user.getIdToken();

  // Add Authorization header
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);

  return fetch(url, {
    ...options,
    headers,
  });
}
