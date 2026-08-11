/**
 * Firebase Auth Context Provider
 * Provides authentication state and user information throughout the app
 */

'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from './config';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: Error | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  error: null,
});

async function syncUserRecord(user: User): Promise<void> {
  const token = await user.getIdToken();
  const response = await fetch('/api/auth/sync-user', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`User synchronization failed with status ${response.status}`);
  }
}

/**
 * Hook to access authentication state
 */
export function useAuth() {
  return useContext(AuthContext);
}

/**
 * Auth Provider component
 * Wraps the app to provide authentication state
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    // Subscribe to auth state changes
    const unsubscribe = onAuthStateChanged(
      auth,
      async (user) => {
        let syncError: Error | null = null;
        if (user) {
          try {
            // Account/profile routes reference this row. Await the idempotent
            // upsert before exposing the user to plan bootstrap.
            await syncUserRecord(user);
          } catch (error) {
            syncError = error instanceof Error ? error : new Error('Failed to sync user record');
            console.error('Failed to sync user record:', error);
          }
        }
        if (!active) return;
        setUser(user);
        setLoading(false);
        setError(syncError);
      },
      (error) => {
        console.error('Auth state change error:', error);
        setError(error);
        setLoading(false);
      }
    );

    // Cleanup subscription on unmount
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, error }}>
      {children}
    </AuthContext.Provider>
  );
}
