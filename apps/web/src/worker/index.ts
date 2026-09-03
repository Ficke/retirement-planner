import { proxyToOrigin } from './proxy';

/**
 * Paths this Worker answers itself, and the subsystem that answers each.
 * Everything else still proxies to Cloud Run.
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

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const index = subsystemFor(new URL(request.url).pathname);
    if (index < 0) return proxyToOrigin(request, env);

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
