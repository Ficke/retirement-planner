import { GoogleAuth, type IdTokenClient } from 'google-auth-library';

const DEFAULT_RUST_SERVICE_URL = 'http://localhost:8081';
const googleAuth = new GoogleAuth();
const idTokenClients = new Map<string, Promise<IdTokenClient>>();

function getServiceUrl(): string {
  return (process.env.RUST_SERVICE_URL || DEFAULT_RUST_SERVICE_URL).replace(/\/+$/, '');
}

function requiresIdToken(serviceUrl: string): boolean {
  const hostname = new URL(serviceUrl).hostname;
  return hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '[::1]';
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
