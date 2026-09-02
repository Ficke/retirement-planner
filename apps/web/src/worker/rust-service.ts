import { RustServiceUnavailableError } from '@/lib/rust-service-error';
import type { RustServiceFetch } from '@/lib/simulation-proxy';
import { googleIdToken } from './google-id-token';

/**
 * The Rust service is private: Google's front end rejects an unsigned request
 * before a container starts. https is required unconditionally here, unlike on
 * Cloud Run, where the same client also serves local and compose wiring over
 * plain http. At the edge that heuristic has no case to serve, and a
 * misconfigured URL would send plan data unauthenticated.
 */
function serviceUrl(env: Env): string {
  const configured = env.RUST_SERVICE_URL?.replace(/\/+$/, '') ?? '';
  if (!configured || !URL.canParse(configured) || new URL(configured).protocol !== 'https:') {
    throw new RustServiceUnavailableError('RUST_SERVICE_URL must be an https URL');
  }
  return configured;
}

/** Bind a Rust-service caller to this request's environment and colo cache. */
export function edgeRustService(env: Env, requestUrl: string): RustServiceFetch {
  return async (path, init) => {
    const url = serviceUrl(env);
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${await googleIdToken(env, url, requestUrl)}`);

    try {
      return await fetch(`${url}${path}`, { ...init, headers });
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
  };
}
