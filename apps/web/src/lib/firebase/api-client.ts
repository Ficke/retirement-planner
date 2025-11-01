/**
 * Authenticated API Client
 * Automatically adds Firebase ID token to API requests
 */

import { auth } from './config';

/**
 * Wait for Firebase auth to be ready
 * Returns the current user or null if not authenticated
 */
async function waitForAuthReady(): Promise<any> {
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
    const unsubscribe = auth.onAuthStateChanged((user: any) => {
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
  options: RequestInit = {}
): Promise<Response> {
  // Wait for Firebase to initialize
  const user = await waitForAuthReady();

  if (!user) {
    throw new Error('Not authenticated');
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

/**
 * Helper for making authenticated GET requests
 */
export async function authenticatedGet<T>(url: string): Promise<T> {
  const response = await authenticatedFetch(url, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Helper for making authenticated POST requests
 */
export async function authenticatedPost<T>(url: string, data: any): Promise<T> {
  const response = await authenticatedFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Helper for making authenticated PUT requests
 */
export async function authenticatedPut<T>(url: string, data: any): Promise<T> {
  const response = await authenticatedFetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Helper for making authenticated DELETE requests
 */
export async function authenticatedDelete<T>(url: string): Promise<T> {
  const response = await authenticatedFetch(url, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}
