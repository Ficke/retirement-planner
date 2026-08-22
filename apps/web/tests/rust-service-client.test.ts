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

import { fetchRustService, RustServiceUnavailableError } from '@/lib/rust-service-client';

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

  it('uses unauthenticated requests for a non-localhost http host', async () => {
    process.env.RUST_SERVICE_URL = 'http://rust-simulation:8081';

    await fetchRustService('/api/simulate', { method: 'POST' });

    expect(authMocks.getIdTokenClient).not.toHaveBeenCalled();
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(request.headers).get('authorization')).toBeNull();
  });

  // The ID-token client cache is module-level and outlives each test, so every
  // case below needs its own host to stay independent of the others.
  it('reports a failed token mint as an unavailable service', async () => {
    process.env.RUST_SERVICE_URL = 'https://rust-mint-failure.example.run.app';
    authMocks.getIdTokenClient.mockRejectedValue(
      new Error('Could not load the default credentials'),
    );

    await expect(fetchRustService('/api/simulate', { method: 'POST' })).rejects.toBeInstanceOf(
      RustServiceUnavailableError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries the token mint after a failure instead of caching the rejection', async () => {
    process.env.RUST_SERVICE_URL = 'https://rust-mint-retry.example.run.app';
    authMocks.getIdTokenClient.mockRejectedValueOnce(new Error('transient'));

    await expect(fetchRustService('/api/simulate', { method: 'POST' })).rejects.toBeInstanceOf(
      RustServiceUnavailableError,
    );
    await expect(fetchRustService('/api/simulate', { method: 'POST' })).resolves.toBeDefined();
    expect(authMocks.getIdTokenClient).toHaveBeenCalledTimes(2);
  });

  it('leaves an aborted request distinguishable from an unreachable service', async () => {
    process.env.RUST_SERVICE_URL = 'http://localhost:8081';
    const aborted = new Error('The operation was aborted');
    aborted.name = 'AbortError';
    fetchMock.mockRejectedValue(aborted);

    await expect(fetchRustService('/api/simulate', { method: 'POST' })).rejects.toBe(aborted);
  });

  it('uses the signal reason when the transport reports a generic disconnect', async () => {
    process.env.RUST_SERVICE_URL = 'http://localhost:8081';
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockRejectedValue(new TypeError('Client connection prematurely closed'));

    await expect(fetchRustService('/api/simulate', {
      method: 'POST',
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('wraps a transport failure as an unavailable service', async () => {
    process.env.RUST_SERVICE_URL = 'http://localhost:8081';
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(fetchRustService('/api/simulate', { method: 'POST' })).rejects.toBeInstanceOf(
      RustServiceUnavailableError,
    );
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
