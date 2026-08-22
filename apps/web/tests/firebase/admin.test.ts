import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  jwtVerify: vi.fn(),
  jwks: vi.fn(),
}));

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => mocks.jwks),
  jwtVerify: mocks.jwtVerify,
}));

import { verifyAuthToken } from '@/lib/firebase/admin';

describe('Firebase public-key token verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('FIREBASE_PROJECT_ID', 'test-project');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects a missing bearer token without verifying a JWT', async () => {
    await expect(verifyAuthToken(null)).resolves.toBeNull();
    expect(mocks.jwtVerify).not.toHaveBeenCalled();
  });

  it('pins the Firebase issuer, audience, algorithm, and public key set', async () => {
    const now = Math.floor(Date.now() / 1000);
    mocks.jwtVerify.mockResolvedValue({
      payload: {
        sub: 'firebase-uid',
        email: 'owner@example.test',
        name: 'Owner',
        email_verified: true,
        iat: now - 10,
        auth_time: now - 20,
      },
    });

    await expect(verifyAuthToken('Bearer signed-token')).resolves.toEqual({
      uid: 'firebase-uid',
      email: 'owner@example.test',
      name: 'Owner',
      emailVerified: true,
    });
    expect(mocks.jwtVerify).toHaveBeenCalledWith('signed-token', mocks.jwks, {
      algorithms: ['RS256'],
      audience: 'test-project',
      issuer: 'https://securetoken.google.com/test-project',
    });
  });

  it('rejects malformed identity and future authentication claims', async () => {
    const now = Math.floor(Date.now() / 1000);
    mocks.jwtVerify.mockResolvedValueOnce({
      payload: { sub: '', iat: now, auth_time: now },
    });
    await expect(verifyAuthToken('Bearer no-subject')).resolves.toBeNull();

    mocks.jwtVerify.mockResolvedValueOnce({
      payload: { sub: 'firebase-uid', iat: now, auth_time: now + 60 },
    });
    await expect(verifyAuthToken('Bearer future-auth')).resolves.toBeNull();
  });
});
