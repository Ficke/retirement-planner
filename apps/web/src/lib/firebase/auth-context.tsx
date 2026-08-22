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
  /** True only after the authenticated user row is ready for cloud data APIs. */
  cloudReady: boolean;
  loading: boolean;
  error: Error | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  cloudReady: false,
  loading: true,
  error: null,
});

const INVITE_CODE_KEY = 'retire-plan:invite-code';

export class SyncUserError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'SyncUserError';
  }
}

// The signup form and this provider both sync the brand-new user, in an order
// neither controls. Parking the code where both read it means whichever request
// lands first carries it, instead of one of them being rejected as uninvited.
export function stashInviteCode(code: string): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(INVITE_CODE_KEY, code);
}

export function clearInviteCode(): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(INVITE_CODE_KEY);
}

function readInviteCode(): string | undefined {
  if (typeof sessionStorage === 'undefined') return undefined;
  return sessionStorage.getItem(INVITE_CODE_KEY) ?? undefined;
}

export async function syncUserRecord(user: User): Promise<void> {
  const token = await user.getIdToken();
  const response = await fetch('/api/auth/sync-user', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inviteCode: readInviteCode() }),
  });
  if (!response.ok) {
    const message = await response
      .json()
      .then((body) => (typeof body?.error === 'string' ? body.error : null))
      .catch(() => null);
    throw new SyncUserError(
      response.status,
      message ?? `User synchronization failed with status ${response.status}`
    );
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
  const [cloudReady, setCloudReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!auth) {
      setUser(null);
      setCloudReady(false);
      setLoading(false);
      return;
    }

    let active = true;
    let authGeneration = 0;
    // Subscribe to auth state changes
    const unsubscribe = onAuthStateChanged(
      auth,
      async (nextUser) => {
        const generation = ++authGeneration;
        setLoading(true);
        setCloudReady(false);
        setError(null);

        let syncError: Error | null = null;
        let nextCloudReady = false;
        if (nextUser) {
          try {
            // Account/profile routes reference this row. Await the idempotent
            // upsert before exposing the user to plan bootstrap.
            await syncUserRecord(nextUser);
            nextCloudReady = true;
          } catch (error) {
            syncError = error instanceof Error ? error : new Error('Failed to sync user record');
            console.error('Failed to sync user record:', error);
          }
        }
        if (!active || generation !== authGeneration) return;
        setUser(nextUser);
        setCloudReady(nextCloudReady);
        setLoading(false);
        setError(syncError);
      },
      (error) => {
        authGeneration++;
        console.error('Auth state change error:', error);
        setUser(null);
        setCloudReady(false);
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
    <AuthContext.Provider value={{ user, cloudReady, loading, error }}>
      {children}
    </AuthContext.Provider>
  );
}
