import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  getIdTokenClient: vi.fn(),
  getRequestHeaders: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
  GoogleAuth: vi.fn().mockImplementation(() => ({
    getIdTokenClient: authMocks.getIdTokenClient,
  })),
}));

import { fetchRustService } from '@/lib/rust-service-client';

describe('fetchRustService', () => {
  const originalServiceUrl = process.env.RUST_SERVICE_URL;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    authMocks.getIdTokenClient.mockResolvedValue({
      getRequestHeaders: authMocks.getRequestHeaders,
    });
    authMocks.getRequestHeaders.mockResolvedValue(
      new Headers({ Authorization: 'Bearer test-token' }),
    );
  });

  afterEach(() => {
    if (originalServiceUrl === undefined) {
      delete process.env.RUST_SERVICE_URL;
    } else {
      process.env.RUST_SERVICE_URL = originalServiceUrl;
    }
    vi.unstubAllGlobals();
  });

  it('uses unauthenticated requests for local development', async () => {
    process.env.RUST_SERVICE_URL = 'http://localhost:8081/';

    await fetchRustService('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(authMocks.getIdTokenClient).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8081/api/simulate',
      expect.objectContaining({ method: 'POST' }),
    );
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(request.headers).get('authorization')).toBeNull();
  });

  it('uses a cached ID-token client for Cloud Run requests', async () => {
    process.env.RUST_SERVICE_URL = 'https://rust.example.run.app/';

    await fetchRustService('/api/simulate', { method: 'POST' });
    await fetchRustService('/api/batch', { method: 'POST' });

    expect(authMocks.getIdTokenClient).toHaveBeenCalledOnce();
    expect(authMocks.getIdTokenClient).toHaveBeenCalledWith('https://rust.example.run.app');
    expect(authMocks.getRequestHeaders).toHaveBeenCalledTimes(2);

    for (const [, request] of fetchMock.mock.calls) {
      expect(new Headers((request as RequestInit).headers).get('authorization')).toBe(
        'Bearer test-token',
      );
    }
  });
});
