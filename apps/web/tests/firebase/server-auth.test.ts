import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
}));

vi.mock('@/lib/firebase/admin', () => ({ verifyAuthToken: mocks.verifyAuthToken }));

import { getAuthUser, requireAuth } from '@/lib/firebase/server-auth';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('server Firebase authentication', () => {
  it('rejects requests without a bearer token without invoking Firebase', async () => {
    mocks.verifyAuthToken.mockResolvedValue(null);
    await expect(getAuthUser(new Headers())).resolves.toBeNull();
    expect(mocks.verifyAuthToken).toHaveBeenCalledWith(null);
  });

  it('returns only identity fields from a verified Firebase token', async () => {
    mocks.verifyAuthToken.mockResolvedValue({
      uid: 'firebase-owner',
      email: 'owner@example.test',
      admin: true,
    });

    await expect(getAuthUser(new Headers({ Authorization: 'Bearer valid-token' }))).resolves.toEqual({
      id: 'firebase-owner',
      email: 'owner@example.test',
      name: null,
    });
    expect(mocks.verifyAuthToken).toHaveBeenCalledWith('Bearer valid-token');
  });

  it('treats an invalid verified token as unauthenticated', async () => {
    mocks.verifyAuthToken.mockResolvedValue(null);
    const headers = new Headers({ Authorization: 'Bearer invalid-token' });

    await expect(getAuthUser(headers)).resolves.toBeNull();
    await expect(requireAuth(headers)).rejects.toThrow('Unauthorized');
  });
});
