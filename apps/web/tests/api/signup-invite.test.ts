import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => {
  const db = {
    initialize: vi.fn(),
    query: vi.fn(),
  };
  return {
    db,
    getUnifiedDatabaseService: vi.fn(() => db),
    verifyAuthToken: vi.fn(),
    getClientIp: vi.fn(() => '127.0.0.1'),
    rateLimit: vi.fn(),
  };
});

vi.mock('@/lib/firebase/server', () => ({ verifyAuthToken: mocks.verifyAuthToken }));
vi.mock('@/services/server/database', () => ({
  getUnifiedDatabaseService: mocks.getUnifiedDatabaseService,
}));
vi.mock('@/lib/rate-limit', () => ({
  getClientIp: mocks.getClientIp,
  rateLimit: mocks.rateLimit,
}));

import { POST as syncUser } from '@/app/api/auth/sync-user/route';
import { verifyInviteCode } from '@/lib/invite-code';

const token = { uid: 'firebase-uid', email: 'new@example.test', name: 'New User' };

function request(body?: unknown): NextRequest {
  return new NextRequest('https://retire.test/api/auth/sync-user', {
    method: 'POST',
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const NO_ROWS = { rows: [] };
const ONE_ROW = { rows: [{ id: token.uid }] };

describe('signup invite gate', () => {
  const originalCodes = process.env.SIGNUP_INVITE_CODES;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SIGNUP_INVITE_CODES = 'alpha, beta';
    mocks.verifyAuthToken.mockResolvedValue(token);
    mocks.rateLimit.mockResolvedValue({ success: true, remaining: 9, reset: Date.now() + 1000 });
  });

  afterEach(() => {
    if (originalCodes === undefined) delete process.env.SIGNUP_INVITE_CODES;
    else process.env.SIGNUP_INVITE_CODES = originalCodes;
  });

  it('rejects a new user with no invite code and writes no row', async () => {
    mocks.db.query.mockResolvedValueOnce(NO_ROWS);

    const response = await syncUser(request({}));

    expect(response.status).toBe(403);
    expect(mocks.db.query).toHaveBeenCalledTimes(1);
    expect(mocks.db.query.mock.calls[0][0]).toContain('UPDATE users');
  });

  it('rejects a new user with a wrong invite code', async () => {
    mocks.db.query.mockResolvedValueOnce(NO_ROWS);

    const response = await syncUser(request({ inviteCode: 'gamma' }));

    expect(response.status).toBe(403);
    expect(mocks.db.query).toHaveBeenCalledTimes(1);
  });

  it('creates the row for a new user with a valid invite code', async () => {
    mocks.db.query.mockResolvedValueOnce(NO_ROWS).mockResolvedValueOnce(NO_ROWS);

    const response = await syncUser(request({ inviteCode: 'beta' }));

    expect(response.status).toBe(200);
    expect(mocks.db.query).toHaveBeenCalledTimes(2);
    expect(mocks.db.query.mock.calls[1][0]).toContain('INSERT INTO users');
  });

  it('lets an existing user sign in without a code', async () => {
    mocks.db.query.mockResolvedValueOnce(ONE_ROW);

    const response = await syncUser(request({}));

    expect(response.status).toBe(200);
    expect(mocks.db.query).toHaveBeenCalledTimes(1);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
  });

  it('tolerates a request with no body at all', async () => {
    mocks.db.query.mockResolvedValueOnce(ONE_ROW);

    expect((await syncUser(request())).status).toBe(200);
  });

  it('rate-limits repeated invite attempts', async () => {
    mocks.db.query.mockResolvedValueOnce(NO_ROWS);
    mocks.rateLimit.mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 60_000 });

    const response = await syncUser(request({ inviteCode: 'alpha' }));

    expect(response.status).toBe(429);
    expect(mocks.db.query).toHaveBeenCalledTimes(1);
  });

  it('closes signup when no codes are configured', () => {
    delete process.env.SIGNUP_INVITE_CODES;
    expect(verifyInviteCode('alpha')).toBe(false);
    expect(verifyInviteCode('')).toBe(false);
  });

  it('accepts any configured code and rejects near misses', () => {
    expect(verifyInviteCode('alpha')).toBe(true);
    expect(verifyInviteCode('beta')).toBe(true);
    expect(verifyInviteCode('alph')).toBe(false);
    expect(verifyInviteCode('alphaa')).toBe(false);
    expect(verifyInviteCode(undefined)).toBe(false);
  });
});
