import { proxyToOrigin } from './proxy';

/** Paths this Worker answers itself. Everything else still proxies to Cloud Run. */
const PORTED_PATH_PREFIXES = ['/api/profile', '/api/accounts', '/api/auth/sync-user'];

function isPorted(pathname: string): boolean {
  return PORTED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * The data subsystem is loaded on first use, not at startup.
 *
 * Its module graph — the Hono app, jose, and every zod schema the API
 * validates against — costs real CPU to evaluate, and a Worker's global scope
 * is charged to whichever request happens to warm the isolate. Most traffic
 * here is proxied and never touches any of it, so paying for it on those
 * requests is waste that the free plan's per-request CPU ceiling makes
 * expensive.
 */
let dataApp: Promise<typeof import('./app')> | null = null;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (!isPorted(pathname)) return proxyToOrigin(request, env);

    dataApp ??= import('./app');
    const { edgeApp } = await dataApp;
    return edgeApp.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

// Durable Object classes must be reachable from the entry module's exports, so
// this one stays static. It pulls in nothing beyond the quota arithmetic.
export { QuotaCounter } from './quota-counter';
