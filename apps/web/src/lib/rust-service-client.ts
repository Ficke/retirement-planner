import { GoogleAuth, type IdTokenClient } from 'google-auth-library';

const DEFAULT_RUST_SERVICE_URL = 'http://localhost:8081';
const googleAuth = new GoogleAuth();
const idTokenClients = new Map<string, Promise<IdTokenClient>>();

/** The Rust service could not be reached or authenticated to. */
export class RustServiceUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RustServiceUnavailableError';
  }
}

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

  let authorization: string | null;
  try {
    const client = await clientPromise;
    const authHeaders = await client.getRequestHeaders();
    authorization = authHeaders.get('authorization');
  } catch (error) {
    // A failed mint is cached as a rejected promise; drop it so the next
    // request retries instead of replaying this failure forever.
    idTokenClients.delete(serviceUrl);
    throw new RustServiceUnavailableError('Could not obtain a Cloud Run identity token', {
      cause: error,
    });
  }

  if (!authorization) {
    throw new RustServiceUnavailableError('Cloud Run identity token was not available');
  }
  return authorization;
}

export async function fetchRustService(path: string, init: RequestInit): Promise<Response> {
  const serviceUrl = getServiceUrl();
  const headers = new Headers(init.headers);

  if (requiresIdToken(serviceUrl)) {
    headers.set('Authorization', await getAuthorizationHeader(serviceUrl));
  }

  try {
    return await fetch(`${serviceUrl}${path}`, { ...init, headers });
  } catch (error) {
    if (init.signal?.aborted) {
      const reason = init.signal.reason;
      throw reason instanceof Error
        ? reason
        : new DOMException('The operation was aborted', 'AbortError');
    }
    // An aborted request is the caller's timeout, not an unreachable service;
    // it has to stay distinguishable so the routes can still answer 504.
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw error;
    }
    throw new RustServiceUnavailableError('Could not reach the simulation service', {
      cause: error,
    });
  }
}
