/**
 * Firebase Client-Side Exports
 * Only client-safe exports - no server-side code
 *
 * For server-side functions, import from '@/lib/firebase/server'
 */

// Client-side exports only
export { auth } from './config';
export { signUp, signIn, signOut, resetPassword, getIdToken } from './auth';
export { useAuth, AuthProvider } from './auth-context';
export { authenticatedFetch } from './api-client';
