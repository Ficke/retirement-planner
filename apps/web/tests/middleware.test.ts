import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import {
  ORIGIN_AUTHENTICATED_HEADER,
  ORIGIN_SECRET_HEADER,
  TRUSTED_CLIENT_IP_HEADER,
} from '@/lib/origin-auth';

const requestFor = (path: string, headers?: HeadersInit) =>
  new NextRequest(`https://origin.example${path}`, { headers });

const forwardedRequestHeader = (response: Response, name: string) =>
  response.headers.get(`x-middleware-request-${name}`);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('origin authentication middleware', () => {
  it('rejects a missing or incorrect secret when enforcement is configured', () => {
    vi.stubEnv('ORIGIN_SECRET', 'expected-secret');

    expect(middleware(requestFor('/')).status).toBe(403);
    expect(
      middleware(requestFor('/', { [ORIGIN_SECRET_HEADER]: 'incorrect-secret' })).status,
    ).toBe(403);
  });

  it('authenticates the Worker, removes the secret, and forwards its trusted IP', () => {
    vi.stubEnv('ORIGIN_SECRET', 'expected-secret');
    const response = middleware(
      requestFor('/api/simulation/monte-carlo', {
        [ORIGIN_SECRET_HEADER]: 'expected-secret',
        [ORIGIN_AUTHENTICATED_HEADER]: 'spoofed',
        [TRUSTED_CLIENT_IP_HEADER]: '203.0.113.9',
      }),
    );

    expect(response.status).toBe(200);
    expect(forwardedRequestHeader(response, ORIGIN_SECRET_HEADER)).toBeNull();
    expect(forwardedRequestHeader(response, ORIGIN_AUTHENTICATED_HEADER)).toBe('1');
    expect(forwardedRequestHeader(response, TRUSTED_CLIENT_IP_HEADER)).toBe('203.0.113.9');
  });

  it('exempts only the exact health path and strips private headers there', () => {
    vi.stubEnv('ORIGIN_SECRET', 'expected-secret');
    const healthResponse = middleware(
      requestFor('/healthz', {
        [ORIGIN_SECRET_HEADER]: 'spoofed',
        [ORIGIN_AUTHENTICATED_HEADER]: '1',
        [TRUSTED_CLIENT_IP_HEADER]: '203.0.113.9',
      }),
    );

    expect(healthResponse.status).toBe(200);
    expect(forwardedRequestHeader(healthResponse, ORIGIN_SECRET_HEADER)).toBeNull();
    expect(forwardedRequestHeader(healthResponse, ORIGIN_AUTHENTICATED_HEADER)).toBeNull();
    expect(forwardedRequestHeader(healthResponse, TRUSTED_CLIENT_IP_HEADER)).toBeNull();
    expect(middleware(requestFor('/healthz/')).status).toBe(403);
  });

  it('fails closed in production when the origin secret is not mounted', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ORIGIN_SECRET', '');

    expect(middleware(requestFor('/')).status).toBe(503);
  });

  it('keeps direct local development usable without a configured secret', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ORIGIN_SECRET', '');

    expect(middleware(requestFor('/')).status).toBe(200);
  });
});
