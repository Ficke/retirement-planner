/**
 * Firebase Server-Side Exports
 * Only for use in the Hono server
 *
 * DO NOT import this in Client Components - use '@/lib/firebase' instead
 */

// Server-side exports only
export { getAuthUser, requireAuth } from './server-auth';
export { verifyAuthToken } from './admin';
