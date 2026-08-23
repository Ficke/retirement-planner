import { afterEach, describe, expect, it, vi } from 'vitest';

import { ORIGIN_SECRET_HEADER, TRUSTED_CLIENT_IP_HEADER } from '@/lib/origin-auth';
import { app } from '@/server/app';

const requestFor = (path: string, headers?: HeadersInit) =>
  app.request(`https://origin.example${path}`, { headers });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('origin authentication middleware', () => {
  it('permits WebAssembly compilation without permitting general eval', async () => {
    const response = await requestFor('/healthz');
    const contentSecurityPolicy = response.headers.get('Content-Security-Policy');

    expect(contentSecurityPolicy).toContain("'wasm-unsafe-eval'");
    expect(contentSecurityPolicy).not.toContain("'unsafe-eval'");
  });

  it('rejects a missing or incorrect secret when enforcement is configured', async () => {
    vi.stubEnv('ORIGIN_SECRET', 'expected-secret');

    expect((await requestFor('/api/not-real')).status).toBe(403);
    expect(
      (await requestFor('/api/not-real', { [ORIGIN_SECRET_HEADER]: 'incorrect-secret' })).status,
    ).toBe(403);
  });

  it('authenticates the Worker without reflecting its secret', async () => {
    vi.stubEnv('ORIGIN_SECRET', 'expected-secret');
    const response = await requestFor('/api/not-real', {
      [ORIGIN_SECRET_HEADER]: 'expected-secret',
      [TRUSTED_CLIENT_IP_HEADER]: '203.0.113.9',
    });

    expect(response.status).toBe(404);
    expect(response.headers.get(ORIGIN_SECRET_HEADER)).toBeNull();
  });

  it('accepts the previous secret during a rotation window', async () => {
    vi.stubEnv('ORIGIN_SECRET', 'incoming-secret');
    vi.stubEnv('ORIGIN_SECRET_PREVIOUS', 'outgoing-secret');

    expect(
      (await requestFor('/api/not-real', { [ORIGIN_SECRET_HEADER]: 'outgoing-secret' })).status,
    ).toBe(404);
  });

  it('exempts only the exact health path', async () => {
    vi.stubEnv('ORIGIN_SECRET', 'expected-secret');

    expect((await requestFor('/healthz')).status).toBe(200);
    expect((await requestFor('/healthz/')).status).toBe(403);
  });

  it('fails closed in production when the origin secret is not mounted', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ORIGIN_SECRET', '');

    expect((await requestFor('/api/not-real')).status).toBe(503);
  });

  it('keeps direct local development usable without a configured secret', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ORIGIN_SECRET', '');

    expect((await requestFor('/api/not-real')).status).toBe(404);
  });
});
