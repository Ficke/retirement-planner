import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  verifyAuthToken: vi.fn(),
}));

vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('@/lib/firebase/admin', () => ({ verifyAuthToken: mocks.verifyAuthToken }));

import { getAuthUser, requireAuth } from '@/lib/firebase/server-auth';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('server Firebase authentication', () => {
  it('rejects requests without a bearer token without invoking Firebase', async () => {
    mocks.headers.mockResolvedValue(new Headers());

    await expect(getAuthUser()).resolves.toBeNull();
    expect(mocks.verifyAuthToken).not.toHaveBeenCalled();
  });

  it('returns only identity fields from a verified Firebase token', async () => {
    mocks.headers.mockResolvedValue(new Headers({ Authorization: 'Bearer valid-token' }));
    mocks.verifyAuthToken.mockResolvedValue({
      uid: 'firebase-owner',
      email: 'owner@example.test',
      admin: true,
    });

    await expect(getAuthUser()).resolves.toEqual({
      id: 'firebase-owner',
      email: 'owner@example.test',
      name: null,
    });
    expect(mocks.verifyAuthToken).toHaveBeenCalledWith('Bearer valid-token');
  });

  it('treats an invalid verified token as unauthenticated', async () => {
    mocks.headers.mockResolvedValue(new Headers({ Authorization: 'Bearer invalid-token' }));
    mocks.verifyAuthToken.mockResolvedValue(null);

    await expect(getAuthUser()).resolves.toBeNull();
    await expect(requireAuth()).rejects.toThrow('Unauthorized');
  });
});
