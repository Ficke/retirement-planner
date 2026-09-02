import { RustServiceUnavailableError } from '@/lib/rust-service-error';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const ASSERTION_LIFETIME_SECONDS = 3600;

/**
 * Serve a token for less than the hour Google grants it, so no request starts
 * with one about to expire; the spread keeps colos from re-minting in lockstep.
 */
const CACHE_LIFETIME_SECONDS = 55 * 60;
const CACHE_SPREAD_SECONDS = 120;
/** Refuse a cached token this close to its expiry. */
const EXPIRY_MARGIN_SECONDS = 60;

interface ServiceAccount {
  clientEmail: string;
  privateKeyId: string;
  privateKey: string;
}

interface MintedToken {
  token: string;
  expiresAt: number;
}

function serviceAccount(env: Env): ServiceAccount {
  const { GCP_SA_CLIENT_EMAIL, GCP_SA_PRIVATE_KEY_ID, GCP_SA_PRIVATE_KEY } = env;
  if (!GCP_SA_CLIENT_EMAIL || !GCP_SA_PRIVATE_KEY_ID || !GCP_SA_PRIVATE_KEY) {
    throw new RustServiceUnavailableError('Edge invoker credentials are not configured');
  }
  return {
    clientEmail: GCP_SA_CLIENT_EMAIL,
    privateKeyId: GCP_SA_PRIVATE_KEY_ID,
    privateKey: GCP_SA_PRIVATE_KEY,
  };
}

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlText(value: string): string {
  return base64Url(new TextEncoder().encode(value));
}

function decodeBase64Url(value: string): string {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(
    value.length + ((4 - (value.length % 4)) % 4),
    '=',
  );
  return atob(padded);
}

const PEM_BODY = /-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/;

function pkcs8(privateKey: string): ArrayBuffer {
  // A key lifted out of the service-account JSON by hand arrives with literal
  // backslash-n rather than newlines, and the PEM body is unusable that way.
  const body = PEM_BODY.exec(privateKey.replaceAll('\\n', '\n'))?.[1];
  if (!body) throw new RustServiceUnavailableError('Edge invoker key is not a PKCS#8 PEM');

  const der = atob(body.replace(/\s+/g, ''));
  const bytes = new Uint8Array(der.length);
  for (let i = 0; i < der.length; i += 1) bytes[i] = der.charCodeAt(i);
  return bytes.buffer;
}

/**
 * The imported signing key, kept for the isolate's life.
 *
 * Importing costs real CPU on a plan that charges 10ms per request, and the key
 * only changes when the secret is rotated — which replaces the isolate anyway.
 * The id is held alongside so a rotation cannot be served by a stale key.
 */
let signingKey: { id: string; key: Promise<CryptoKey> } | null = null;

function importSigningKey(account: ServiceAccount): Promise<CryptoKey> {
  if (signingKey?.id !== account.privateKeyId) {
    const key = crypto.subtle.importKey(
      'pkcs8',
      pkcs8(account.privateKey),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    // A rejected promise would otherwise be replayed to every later request.
    key.catch(() => {
      if (signingKey?.id === account.privateKeyId) signingKey = null;
    });
    signingKey = { id: account.privateKeyId, key };
  }
  return signingKey.key;
}

async function signedAssertion(account: ServiceAccount, audience: string): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const claims = {
    iss: account.clientEmail,
    sub: account.clientEmail,
    aud: TOKEN_ENDPOINT,
    target_audience: audience,
    iat: issuedAt,
    exp: issuedAt + ASSERTION_LIFETIME_SECONDS,
  };
  const signingInput =
    `${base64UrlText(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: account.privateKeyId }))}` +
    `.${base64UrlText(JSON.stringify(claims))}`;

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    await importSigningKey(account),
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64Url(signature)}`;
}

/** Read `aud` and `exp` without verifying: Google signed it, Cloud Run checks it. */
function tokenClaims(token: string): { aud?: unknown; exp?: unknown } | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    return JSON.parse(decodeBase64Url(payload));
  } catch {
    return null;
  }
}

function usableToken(token: string, audience: string): MintedToken | null {
  const claims = tokenClaims(token);
  if (!claims || claims.aud !== audience || typeof claims.exp !== 'number') return null;

  const expiresAt = claims.exp * 1000;
  if (expiresAt - EXPIRY_MARGIN_SECONDS * 1000 <= Date.now()) return null;
  return { token, expiresAt };
}

async function exchangeForIdToken(
  account: ServiceAccount,
  audience: string,
): Promise<MintedToken> {
  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: JWT_BEARER_GRANT,
        assertion: await signedAssertion(account, audience),
      }),
    });
  } catch (error) {
    throw new RustServiceUnavailableError('Could not reach Google to mint an identity token', {
      cause: error,
    });
  }

  // The status alone: an error body from this endpoint echoes the assertion,
  // which is a signed bearer credential.
  if (!response.ok) {
    throw new RustServiceUnavailableError(
      `Google refused the identity token request with ${response.status}`,
    );
  }

  const body = (await response.json()) as { id_token?: unknown };
  const minted =
    typeof body.id_token === 'string' ? usableToken(body.id_token, audience) : null;
  if (!minted) {
    throw new RustServiceUnavailableError('Google returned no usable identity token');
  }
  return minted;
}

/**
 * The token this isolate is using, or the mint that will produce it.
 *
 * A plan refresh fires the headline simulation and the sensitivity batch at
 * once, so a cold isolate would otherwise mint twice for the same audience.
 */
let current: { audience: string; token: Promise<MintedToken> } | null = null;

/**
 * Where the colo-wide copy lives.
 *
 * The Cache API, never KV: a KV value is readable from the dashboard and by any
 * API token with KV read, which is a strictly weaker store than a Worker secret
 * for a live `run.invoker` bearer token. The key carries the private key id, so
 * a rotation invalidates every entry without a purge.
 */
function cacheKey(requestUrl: string, account: ServiceAccount, audience: string): Request {
  const key = new URL('/__edge/id-token', requestUrl);
  key.searchParams.set('kid', account.privateKeyId);
  key.searchParams.set('aud', audience);
  return new Request(key, { method: 'GET' });
}

async function cachedToken(key: Request, audience: string): Promise<MintedToken | null> {
  const hit = await caches.default.match(key);
  return hit ? usableToken((await hit.text()).trim(), audience) : null;
}

function cacheToken(key: Request, minted: MintedToken): Promise<void> {
  const lifetime = Math.min(
    CACHE_LIFETIME_SECONDS - Math.floor(Math.random() * CACHE_SPREAD_SECONDS),
    Math.floor((minted.expiresAt - Date.now()) / 1000) - EXPIRY_MARGIN_SECONDS,
  );
  if (lifetime <= 0) return Promise.resolve();

  return caches.default.put(
    key,
    new Response(minted.token, {
      headers: {
        'Cache-Control': `max-age=${lifetime}`,
        'Content-Type': 'text/plain',
      },
    }),
  );
}

/**
 * A Google-signed OIDC ID token for `audience`, minted with the edge invoker's
 * service-account key.
 *
 * `audience` must be the Cloud Run service URL with no trailing slash — the
 * value Google's front end compares against before a container starts.
 */
export async function googleIdToken(
  env: Env,
  audience: string,
  requestUrl: string,
): Promise<string> {
  const inFlight = current?.audience === audience ? current.token : null;
  if (inFlight) {
    const settled = await inFlight.catch(() => null);
    if (settled && usableToken(settled.token, audience)) return settled.token;
  }

  const account = serviceAccount(env);
  const key = cacheKey(requestUrl, account, audience);
  const mint = (async () => {
    const shared = await cachedToken(key, audience).catch(() => null);
    if (shared) return shared;

    const minted = await exchangeForIdToken(account, audience);
    await cacheToken(key, minted).catch(() => undefined);
    return minted;
  })();

  current = { audience, token: mint };
  try {
    return (await mint).token;
  } catch (error) {
    if (current?.token === mint) current = null;
    throw error;
  }
}
