import { proxyToOrigin } from './proxy';

/**
 * Paths this Worker answers itself, and the subsystem that answers each.
 * Everything else is a navigation, an asset miss, or an origin path; see the
 * routing below.
 *
 * Each subsystem is loaded on first use, not at startup. Its module graph — the
 * Hono app, jose, and every zod schema the API validates against — costs real
 * CPU to evaluate, and a Worker's global scope is charged to whichever request
 * happens to warm the isolate. Most traffic here touches neither, so paying for
 * them on those requests is waste that the free plan's per-request CPU ceiling
 * makes expensive. Keeping the two apart means a profile read never builds the
 * simulation schemas, and a simulation never builds the profile ones.
 */
const SUBSYSTEMS = [
  {
    prefixes: ['/api/profile', '/api/accounts', '/api/auth/sync-user'],
    load: async () => (await import('./app')).edgeApp,
  },
  {
    prefixes: ['/api/simulation'],
    load: async () => (await import('./simulation-app')).simulationApp,
  },
] as const;

type EdgeApp = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
};

const loaded = new Map<number, Promise<EdgeApp>>();

function subsystemFor(pathname: string): number {
  return SUBSYSTEMS.findIndex(({ prefixes }) =>
    prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)),
  );
}

const ASSET_PREFIX = '/assets/';

/**
 * A hashed asset that this version's manifest does not list is gone, not a
 * client route. Every deploy replaces the manifest, so a tab open across one
 * asks for a chunk the new version never had. Answering that with the shell
 * hands the browser HTML where it expects a module -- a MIME error and a dead
 * route rather than an honest load failure -- and `_headers` stamps the reply
 * `immutable`, caching the wrong body under the chunk's URL for a year.
 */
function assetMiss(): Response {
  return new Response('Not found', {
    status: 404,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/**
 * Client routes have no file of their own, so a navigation to one arrives here
 * as a miss and is answered with the shell. The asset store serves it, which is
 * what keeps `public/_headers` applied to the response.
 */
function serveShell(request: Request, env: Env): Promise<Response> {
  const shell = new URL('/index.html', request.url);
  return env.ASSETS.fetch(new Request(shell, { method: request.method }));
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    const index = subsystemFor(pathname);

    if (index < 0) {
      if (pathname.startsWith(ASSET_PREFIX)) return assetMiss();
      if (pathname.startsWith('/api/')) return proxyToOrigin(request, env);
      // Anything else with a body or a side effect is still the origin's; only
      // a navigation gets the shell.
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return proxyToOrigin(request, env);
      }
      return serveShell(request, env);
    }

    let app = loaded.get(index);
    if (!app) {
      app = SUBSYSTEMS[index].load();
      loaded.set(index, app);
    }
    return (await app).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

// Durable Object classes must be reachable from the entry module's exports, so
// this one stays static. It pulls in nothing beyond the quota arithmetic.
export { QuotaCounter } from './quota-counter';
