import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RustServiceUnavailableError } from '@/lib/rust-service-error';
import { edgeRustService } from '@/worker/rust-service';
import { serviceAccountKeyPair } from './service-account-key';

const REQUEST_URL = 'https://adamficke.dev/api/simulation/monte-carlo';
const fetchMock = vi.fn();

function base64UrlJson(value: unknown): string {
  return btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function envWith(serviceUrl: string): Env {
  return {
    RUST_SERVICE_URL: serviceUrl,
    GCP_SA_CLIENT_EMAIL: 'edge-invoker@example.iam.gserviceaccount.com',
    GCP_SA_PRIVATE_KEY_ID: 'unused-key',
    GCP_SA_PRIVATE_KEY: 'not-a-pem',
  } as unknown as Env;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('edgeRustService', () => {
  // Cloud Run's client skips the token for a non-https URL so local and compose
  // wiring works. At the edge that heuristic has no case to serve, and a
  // misconfigured URL would send plan data unauthenticated.
  it('refuses to call a service that is not reached over https', async () => {
    const call = edgeRustService(envWith('http://rust.internal:8081'), REQUEST_URL);

    await expect(call('/api/simulate', { method: 'POST' })).rejects.toBeInstanceOf(
      RustServiceUnavailableError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to call an unconfigured service', async () => {
    const call = edgeRustService(envWith(''), REQUEST_URL);

    await expect(call('/api/simulate', { method: 'POST' })).rejects.toThrow(/https URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never sends an unauthenticated request when the token cannot be minted', async () => {
    const call = edgeRustService(envWith('https://rust.example.run.app'), REQUEST_URL);

    await expect(call('/api/simulate', { method: 'POST' })).rejects.toBeInstanceOf(
      RustServiceUnavailableError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports an unreachable service rather than an aborted request', async () => {
    const audience = 'https://rust-reachability.example.run.app';
    const exp = Math.floor(Date.now() / 1000) + 3600;
    fetchMock.mockResolvedValueOnce(
      Response.json({
        id_token: `${base64UrlJson({ alg: 'RS256' })}.${base64UrlJson({ aud: audience, exp })}.sig`,
      }),
    );
    fetchMock.mockRejectedValueOnce(new TypeError('connection refused'));

    const env = {
      ...envWith(audience),
      GCP_SA_PRIVATE_KEY: (await serviceAccountKeyPair()).privateKeyPem,
    } as unknown as Env;
    const call = edgeRustService(env, REQUEST_URL);

    await expect(call('/api/simulate', { method: 'POST' })).rejects.toBeInstanceOf(
      RustServiceUnavailableError,
    );
    expect(fetchMock.mock.calls[1][0]).toBe(`${audience}/api/simulate`);
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get('Authorization')).toMatch(/^Bearer /);
  });
});
