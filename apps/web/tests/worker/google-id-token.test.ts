import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RustServiceUnavailableError } from '@/lib/rust-service-error';
import { googleIdToken } from '@/worker/google-id-token';
import { serviceAccountKeyPair } from './service-account-key';

const REQUEST_URL = 'https://adamficke.dev/api/simulation/monte-carlo';

/**
 * Every test uses its own audience. The minter memoizes per audience and keys
 * its cache entry the same way, so this isolates them without a reset seam.
 */
let audienceCounter = 0;
const nextAudience = () => `https://rust-${(audienceCounter += 1)}.example.run.app`;

function base64UrlJson(value: unknown): string {
  return btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function idTokenFor(audience: string, expiresInSeconds = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return `${base64UrlJson({ alg: 'RS256' })}.${base64UrlJson({ aud: audience, exp })}.signature`;
}

function decodeSegment(segment: string): Record<string, unknown> {
  const padded = segment.replaceAll('-', '+').replaceAll('_', '/');
  return JSON.parse(atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '=')));
}

let keyPair: Awaited<ReturnType<typeof serviceAccountKeyPair>>;
const fetchMock = vi.fn();

function envWith(privateKeyId: string): Env {
  return {
    GCP_SA_CLIENT_EMAIL: 'edge-invoker@example.iam.gserviceaccount.com',
    GCP_SA_PRIVATE_KEY_ID: privateKeyId,
    GCP_SA_PRIVATE_KEY: keyPair.privateKeyPem,
  } as unknown as Env;
}

beforeEach(async () => {
  keyPair ??= await serviceAccountKeyPair();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('googleIdToken', () => {
  it('exchanges a JWT the service-account key signed for an ID token', async () => {
    const audience = nextAudience();
    const minted = idTokenFor(audience);
    fetchMock.mockResolvedValue(Response.json({ id_token: minted }));

    const token = await googleIdToken(envWith('key-1'), audience, REQUEST_URL);

    expect(token).toBe(minted);
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(endpoint).toBe('https://oauth2.googleapis.com/token');

    const form = new URLSearchParams(String(init.body));
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');

    const assertion = form.get('assertion')!;
    const [header, claims, signature] = assertion.split('.');
    expect(decodeSegment(header)).toMatchObject({ alg: 'RS256', typ: 'JWT', kid: 'key-1' });
    expect(decodeSegment(claims)).toMatchObject({
      iss: 'edge-invoker@example.iam.gserviceaccount.com',
      sub: 'edge-invoker@example.iam.gserviceaccount.com',
      aud: 'https://oauth2.googleapis.com/token',
      target_audience: audience,
    });

    const signatureBytes = Uint8Array.from(
      atob(signature.replaceAll('-', '+').replaceAll('_', '/').padEnd(
        signature.length + ((4 - (signature.length % 4)) % 4),
        '=',
      )),
      (character) => character.charCodeAt(0),
    );
    await expect(
      crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        keyPair.publicKey,
        signatureBytes,
        new TextEncoder().encode(`${header}.${claims}`),
      ),
    ).resolves.toBe(true);
  });

  it('reuses a live token rather than minting one per request', async () => {
    const audience = nextAudience();
    fetchMock.mockResolvedValue(Response.json({ id_token: idTokenFor(audience) }));

    const [first, second] = await Promise.all([
      googleIdToken(envWith('key-1'), audience, REQUEST_URL),
      googleIdToken(envWith('key-1'), audience, REQUEST_URL),
    ]);
    const third = await googleIdToken(envWith('key-1'), audience, REQUEST_URL);

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // The isolate memo holds one audience, so this second mint evicts the first
  // and the third call can only be answered by the colo cache.
  it('serves a token another isolate in the same colo already minted', async () => {
    const audience = nextAudience();
    fetchMock.mockResolvedValueOnce(Response.json({ id_token: idTokenFor(audience) }));
    const first = await googleIdToken(envWith('key-1'), audience, REQUEST_URL);

    const other = nextAudience();
    fetchMock.mockResolvedValueOnce(Response.json({ id_token: idTokenFor(other) }));
    await googleIdToken(envWith('key-1'), other, REQUEST_URL);

    await expect(googleIdToken(envWith('key-1'), audience, REQUEST_URL)).resolves.toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // Rotation has to invalidate without a purge: the key id is part of the
  // cache key, so a new key can never be served the old key's token.
  it('mints again when the signing key is rotated', async () => {
    const audience = nextAudience();
    fetchMock.mockResolvedValueOnce(Response.json({ id_token: idTokenFor(audience) }));
    await googleIdToken(envWith('key-1'), audience, REQUEST_URL);

    fetchMock.mockResolvedValueOnce(Response.json({ id_token: idTokenFor(audience) }));
    await googleIdToken(envWith('key-2'), audience, REQUEST_URL);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(decodeSegment(new URLSearchParams(String(fetchMock.mock.calls[1][1].body)).get('assertion')!.split('.')[0]))
      .toMatchObject({ kid: 'key-2' });
  });

  it('refuses a token minted for another audience', async () => {
    const audience = nextAudience();
    fetchMock.mockResolvedValue(Response.json({ id_token: idTokenFor('https://someone-else.example') }));

    await expect(googleIdToken(envWith('key-1'), audience, REQUEST_URL)).rejects.toBeInstanceOf(
      RustServiceUnavailableError,
    );
  });

  it('refuses a token that is already at its expiry', async () => {
    const audience = nextAudience();
    fetchMock.mockResolvedValue(Response.json({ id_token: idTokenFor(audience, 5) }));

    await expect(googleIdToken(envWith('key-1'), audience, REQUEST_URL)).rejects.toBeInstanceOf(
      RustServiceUnavailableError,
    );
  });

  // The error body from this endpoint echoes the assertion, which is itself a
  // signed bearer credential.
  it('reports a refused exchange without repeating the response body', async () => {
    const audience = nextAudience();
    fetchMock.mockResolvedValue(new Response('{"error":"invalid_grant","assertion":"secret"}', { status: 400 }));

    await expect(googleIdToken(envWith('key-1'), audience, REQUEST_URL)).rejects.toThrow(
      /Google refused the identity token request with 400$/,
    );
  });

  it('retries after a failed mint rather than replaying the failure', async () => {
    const audience = nextAudience();
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(googleIdToken(envWith('key-1'), audience, REQUEST_URL)).rejects.toBeInstanceOf(
      RustServiceUnavailableError,
    );

    fetchMock.mockResolvedValueOnce(Response.json({ id_token: idTokenFor(audience) }));
    await expect(googleIdToken(envWith('key-1'), audience, REQUEST_URL)).resolves.toBeTypeOf('string');
  });

  it('fails closed when the invoker credentials are missing', async () => {
    const audience = nextAudience();
    const env = { ...envWith('key-1'), GCP_SA_PRIVATE_KEY: '' } as unknown as Env;

    await expect(googleIdToken(env, audience, REQUEST_URL)).rejects.toThrow(
      /credentials are not configured/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a private key that is not a PKCS#8 PEM', async () => {
    const audience = nextAudience();
    const env = { ...envWith('unimported-key'), GCP_SA_PRIVATE_KEY: 'not-a-pem' } as unknown as Env;

    await expect(googleIdToken(env, audience, REQUEST_URL)).rejects.toThrow(/PKCS#8 PEM/);
  });
});
