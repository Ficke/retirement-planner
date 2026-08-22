import { createRemoteJWKSet, jwtVerify } from 'jose';

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL(
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
  ),
);

export interface VerifiedFirebaseToken {
  uid: string;
  email?: string;
  name?: string;
  emailVerified: boolean;
}

/**
 * Verify a Firebase ID token against Google's public signing keys.
 *
 * Firebase ID tokens remain valid until their normal expiry. This verifier
 * deliberately does not perform the Admin SDK's optional revocation lookup,
 * which keeps runtime authentication keyless and stateless.
 */
export async function verifyAuthToken(
  authHeader: string | null,
): Promise<VerifiedFirebaseToken | null> {
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    console.error('FIREBASE_PROJECT_ID is required to verify Firebase ID tokens');
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, FIREBASE_JWKS, {
      algorithms: ['RS256'],
      audience: projectId,
      issuer: `https://securetoken.google.com/${projectId}`,
    });

    const uid = payload.sub;
    if (!uid || uid.length > 128) return null;

    const now = Math.floor(Date.now() / 1000);
    if (
      typeof payload.iat !== 'number' ||
      payload.iat > now ||
      typeof payload.auth_time !== 'number' ||
      payload.auth_time > now
    ) {
      return null;
    }

    return {
      uid,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      emailVerified: payload.email_verified === true,
    };
  } catch (error) {
    console.error('Error verifying Firebase auth token:', error);
    return null;
  }
}
