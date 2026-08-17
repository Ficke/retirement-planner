import { GoogleAuth, type IdTokenClient } from 'google-auth-library';

const DEFAULT_RUST_SERVICE_URL = 'http://localhost:8081';
const googleAuth = new GoogleAuth();
const idTokenClients = new Map<string, Promise<IdTokenClient>>();

function getServiceUrl(): string {
  return (process.env.RUST_SERVICE_URL || DEFAULT_RUST_SERVICE_URL).replace(/\/+$/, '');
}

// Never send a bearer token over an unencrypted connection. Cloud Run is only
// ever reachable over https, so this covers production; every local and
// container-compose wiring is plain http and needs no token. Do not narrow this
// to a hostname allowlist: any new topology not on the list silently skips auth.
function requiresIdToken(serviceUrl: string): boolean {
  return new URL(serviceUrl).protocol === 'https:';
}

async function getAuthorizationHeader(serviceUrl: string): Promise<string> {
  let clientPromise = idTokenClients.get(serviceUrl);
  if (!clientPromise) {
    clientPromise = googleAuth.getIdTokenClient(serviceUrl);
    idTokenClients.set(serviceUrl, clientPromise);
  }

  const client = await clientPromise;
  const authHeaders = await client.getRequestHeaders();
  const authorization = authHeaders.get('authorization');
  if (!authorization) {
    throw new Error('Cloud Run identity token was not available');
  }
  return authorization;
}

export async function fetchRustService(path: string, init: RequestInit): Promise<Response> {
  const serviceUrl = getServiceUrl();
  const headers = new Headers(init.headers);

  if (requiresIdToken(serviceUrl)) {
    headers.set('Authorization', await getAuthorizationHeader(serviceUrl));
  }

  return fetch(`${serviceUrl}${path}`, { ...init, headers });
}
