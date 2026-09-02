import { edgeApp } from './app';
import { proxyToOrigin } from './proxy';

/** Paths this Worker answers itself. Everything else still proxies to Cloud Run. */
const PORTED_PATH_PREFIXES = ['/api/profile', '/api/accounts', '/api/auth/sync-user'];

function isPorted(pathname: string): boolean {
  return PORTED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (isPorted(pathname)) return edgeApp.fetch(request, env, ctx);
    return proxyToOrigin(request, env);
  },
} satisfies ExportedHandler<Env>;

export { QuotaCounter } from './quota-counter';
