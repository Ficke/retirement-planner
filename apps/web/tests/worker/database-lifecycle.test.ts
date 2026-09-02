import { describe, expect, it, vi } from 'vitest';

// A fake session that records ordering, so the test fails if the connection is
// closed before the handler queries it.
const state = vi.hoisted(() => ({
  closed: false,
  queriedAfterClose: false,
  closeCount: 0,
  openCount: 0,
}));

vi.mock('@/services/server/database-client', () => ({
  openDatabase: async () => {
    state.openCount += 1;
    const guard = <T>(value: T) => {
      if (state.closed) state.queriedAfterClose = true;
      return value;
    };
    return {
      db: {
        query: async () => guard({ rows: [{ version: 14 }] }),
        getUserProfile: async () => guard(null),
        getAccountsForUser: async () => guard([]),
        saveUserProfile: async () => guard(1),
        createAccount: async () => guard({}),
        getAccount: async () => guard(null),
        updateAccount: async () => guard(null),
        deleteAccount: async () => guard(false),
      },
      close: async () => {
        state.closeCount += 1;
        state.closed = true;
      },
    };
  },
}));

vi.mock('@/lib/firebase/server', () => ({
  getAuthUser: async () => ({ id: 'uid-1', email: 'a@example.test', name: null }),
  verifyAuthToken: async () => ({ uid: 'uid-1', email: 'a@example.test', emailVerified: true }),
}));

const { edgeApp } = await import('@/worker/app');

const env = {
  HYPERDRIVE: { connectionString: 'postgresql://u:p@127.0.0.1:5432/neondb' },
} as unknown as Env;

describe('worker database lifecycle', () => {
  it('keeps the connection open for the handler and closes it once afterwards', async () => {
    const ctx = { waitUntil: (p: Promise<unknown>) => void p, passThroughOnException: () => {} };

    const response = await edgeApp.fetch(
      new Request('https://adamficke.dev/api/accounts', {
        headers: { authorization: 'Bearer token' },
      }),
      env,
      ctx as ExecutionContext,
    );

    expect(response.status).toBe(200);
    // The original defect: close() was invoked at request start, so the very
    // first query hit an ended client.
    expect(state.queriedAfterClose).toBe(false);
    expect(state.closed).toBe(true);
    expect(state.closeCount).toBe(1);
    // One connection per request, reused across the schema check and the query.
    expect(state.openCount).toBe(1);
  });
});
