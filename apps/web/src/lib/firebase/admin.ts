/**
 * Firebase Admin SDK Configuration
 * Server-side Firebase for verifying auth tokens and managing users
 */

import { applicationDefault, initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';

let adminApp: App | undefined;
let adminAuth: Auth | undefined;

/**
 * Initialize Firebase Admin SDK (singleton pattern)
 */
function initializeAdminApp(): App {
  if (adminApp) {
    return adminApp;
  }

  // Check if already initialized
  const apps = getApps();
  if (apps.length > 0) {
    adminApp = apps[0];
    return adminApp;
  }

  // Get credentials from environment variables
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  const hasAnyExplicitCredential = Boolean(projectId || clientEmail || privateKey);
  const hasCompleteExplicitCredential = Boolean(projectId && clientEmail && privateKey);
  if (hasAnyExplicitCredential && !hasCompleteExplicitCredential) {
    throw new Error(
      'Firebase Admin SDK credentials are incomplete. Set all explicit credential fields or use Application Default Credentials.'
    );
  }

  adminApp = initializeApp({
    credential: hasCompleteExplicitCredential
      ? cert({
          projectId: projectId!,
          clientEmail: clientEmail!,
          privateKey: privateKey!.replace(/\\n/g, '\n'),
        })
      : applicationDefault(),
  });

  return adminApp;
}

/**
 * Get Firebase Admin Auth instance
 */
export function getAdminAuth(): Auth {
  if (adminAuth) {
    return adminAuth;
  }

  const app = initializeAdminApp();
  adminAuth = getAuth(app);
  return adminAuth;
}

/**
 * Verify Firebase ID token from Authorization header
 * Returns the decoded token with user information
 */
export async function verifyAuthToken(
  authHeader: string | null
): Promise<{ uid: string; email?: string; name?: string; emailVerified: boolean } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.split('Bearer ')[1];
  if (!token) {
    return null;
  }

  try {
    const auth = getAdminAuth();
    const decodedToken = await auth.verifyIdToken(token, true);
    return {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name,
      emailVerified: decodedToken.email_verified ?? false,
    };
  } catch (error) {
    console.error('Error verifying auth token:', error);
    return null;
  }
}
