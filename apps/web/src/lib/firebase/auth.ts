/**
 * Firebase Authentication Helper Functions
 * Client-side auth functions for sign in, sign up, and sign out
 */

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  updateProfile,
  type User,
} from 'firebase/auth';
import { auth } from './config';

function errorCode(error: unknown): string {
  return error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : 'unknown';
}

export interface AuthError {
  code: string;
  message: string;
}

/**
 * Create a new user with email and password
 */
export async function signUp(
  email: string,
  password: string,
  name?: string
): Promise<{ user: User | null; error: AuthError | null }> {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);

    // Update display name if provided
    if (name && userCredential.user) {
      await updateProfile(userCredential.user, { displayName: name });
    }

    return { user: userCredential.user, error: null };
  } catch (error) {
    const code = errorCode(error);
    return { user: null, error: { code, message: getErrorMessage(code) } };
  }
}

/**
 * Sign in with email and password
 */
export async function signIn(
  email: string,
  password: string
): Promise<{ user: User | null; error: AuthError | null }> {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return { user: userCredential.user, error: null };
  } catch (error) {
    const code = errorCode(error);
    return { user: null, error: { code, message: getErrorMessage(code) } };
  }
}

/**
 * Sign out the current user
 */
export async function signOut(): Promise<{ error: AuthError | null }> {
  try {
    await firebaseSignOut(auth);
    return { error: null };
  } catch (error) {
    const code = errorCode(error);
    return { error: { code, message: getErrorMessage(code) } };
  }
}

/**
 * Send password reset email
 */
export async function resetPassword(email: string): Promise<{ error: AuthError | null }> {
  try {
    await sendPasswordResetEmail(auth, email);
    return { error: null };
  } catch (error) {
    const code = errorCode(error);
    return { error: { code, message: getErrorMessage(code) } };
  }
}

/**
 * Convert Firebase error codes to user-friendly messages
 */
function getErrorMessage(errorCode: string): string {
  switch (errorCode) {
    case 'auth/email-already-in-use':
      return 'An account with this email already exists';
    case 'auth/invalid-email':
      return 'Invalid email address';
    case 'auth/operation-not-allowed':
      return 'Email/password accounts are not enabled';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters';
    case 'auth/user-disabled':
      return 'This account has been disabled';
    case 'auth/user-not-found':
      return 'Invalid email or password';
    case 'auth/wrong-password':
      return 'Invalid email or password';
    case 'auth/invalid-credential':
      return 'Invalid email or password';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Please try again later';
    default:
      return 'An error occurred. Please try again';
  }
}

/**
 * Get the current user's ID token
 * Used for authenticating API requests
 */
export async function getIdToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;

  try {
    return await user.getIdToken();
  } catch (error) {
    console.error('Error getting ID token:', error);
    return null;
  }
}
