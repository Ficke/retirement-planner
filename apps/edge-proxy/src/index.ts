const ORIGIN_SECRET_HEADER = 'x-retire-plan-origin-secret';
const CLIENT_IP_HEADER = 'x-retire-plan-client-ip';
const ORIGINAL_HOST_HEADER = 'x-retire-plan-original-host';
const ORIGINAL_PROTO_HEADER = 'x-retire-plan-original-proto';
const REQUEST_ID_HEADER = 'x-retire-plan-request-id';

const STATIC_PATH_PREFIX = '/_next/static/';
const NO_STORE = 'no-store';
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

export interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface ProxyDependencies {
  originFetch(request: Request): Promise<Response>;
  cache: EdgeCache;
}

function protectedRequestHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.startsWith('cf-') ||
    lower.startsWith('forwarded') ||
    lower.startsWith('x-forwarded-') ||
    lower.startsWith('x-retire-plan-') ||
    // Next.js has treated x-middleware-* as internal routing state, and a
    // forged x-middleware-subrequest once skipped middleware entirely
    // (CVE-2025-29927). Origin authentication runs there, so a bypass is a
    // full bypass.
    lower.startsWith('x-middleware-') ||
    lower === 'host' ||
    lower === 'true-client-ip' ||
    lower === 'x-real-ip' ||
    lower === 'x-request-id'
  );
}

function originRequestHeaders(request: Request, env: Env, requestId: string): Headers {
  const headers = new Headers(request.headers);
  for (const name of Array.from(headers.keys())) {
    if (protectedRequestHeader(name)) headers.delete(name);
  }

  const publicUrl = new URL(request.url);
  const clientIp = request.headers.get('cf-connecting-ip')?.trim();
  headers.set(ORIGIN_SECRET_HEADER, env.ORIGIN_SECRET);
  headers.set(ORIGINAL_HOST_HEADER, publicUrl.host);
  headers.set(ORIGINAL_PROTO_HEADER, publicUrl.protocol.slice(0, -1));
  headers.set(REQUEST_ID_HEADER, requestId);
  if (clientIp) headers.set(CLIENT_IP_HEADER, clientIp);
  return headers;
}

function configuredOrigins(env: Env): { origin: URL; canonical: URL } {
  const origin = new URL(env.ORIGIN_URL);
  const canonical = new URL(env.CANONICAL_ORIGIN);
  if (origin.protocol !== 'https:' || canonical.protocol !== 'https:' || !env.ORIGIN_SECRET) {
    throw new Error('Invalid edge proxy configuration');
  }
  return { origin, canonical };
}

function originUrlFor(request: Request, origin: URL): URL {
  const incoming = new URL(request.url);
  const target = new URL(origin);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  target.hash = '';
  return target;
}

function originRequest(request: Request, env: Env, origin: URL, requestId: string): Request {
  const init: RequestInit = {
    method: request.method,
    headers: originRequestHeaders(request, env, requestId),
    redirect: 'manual',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.body !== null) {
    init.body = request.body;
  }
  return new Request(originUrlFor(request, origin), init);
}

function rewriteOriginLocation(
  headers: Headers,
  origin: URL,
  publicRequestUrl: URL,
): void {
  const location = headers.get('location');
  if (!location || (location.startsWith('/') && !location.startsWith('//'))) return;

  let parsed: URL;
  try {
    parsed = new URL(location, origin);
  } catch {
    return;
  }
  if (parsed.origin !== origin.origin) return;

  const rewritten = new URL(parsed.pathname + parsed.search + parsed.hash, publicRequestUrl);
  rewritten.protocol = 'https:';
  headers.set('location', rewritten.toString());
}

function safeResponseHeaders(
  upstream: Response,
  origin: URL,
  publicRequestUrl: URL,
): Headers {
  const headers = new Headers(upstream.headers);
  for (const name of Array.from(headers.keys())) {
    const lower = name.toLowerCase();
    if (
      lower.startsWith('x-retire-plan-') ||
      lower.startsWith('x-cloud-') ||
      lower === 'server' ||
      lower === 'x-powered-by' ||
      lower === 'via' ||
      lower === 'alt-svc' ||
      lower === 'x-request-id'
    ) {
      headers.delete(name);
    }
  }
  rewriteOriginLocation(headers, origin, publicRequestUrl);
  return headers;
}

function isStaticGet(request: Request): boolean {
  return request.method === 'GET' && new URL(request.url).pathname.startsWith(STATIC_PATH_PREFIX);
}

function cacheKey(request: Request, canonical: URL): Request {
  const incoming = new URL(request.url);
  const key = new URL(canonical);
  key.pathname = incoming.pathname;
  key.search = incoming.search;
  return new Request(key, { method: 'GET' });
}

function immutable(upstream: Response): boolean {
  return (
    upstream.status === 200 &&
    !upstream.headers.has('set-cookie') &&
    /(?:^|,)\s*immutable(?:\s*(?:,|$))/i.test(upstream.headers.get('cache-control') ?? '')
  );
}

function responseWithRequestId(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function structuredError(event: string, request: Request, requestId: string): void {
  const url = new URL(request.url);
  console.error(
    JSON.stringify({
      event,
      requestId,
      method: request.method,
      path: url.pathname,
    }),
  );
}

export async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  dependencies?: ProxyDependencies,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  let origins: { origin: URL; canonical: URL };
  try {
    origins = configuredOrigins(env);
  } catch {
    structuredError('edge_configuration_error', request, requestId);
    const failure = new Response('Internal server error', {
      status: 500,
      headers: { 'Cloudflare-CDN-Cache-Control': NO_STORE },
    });
    return responseWithRequestId(failure, requestId);
  }

  const originFetch = dependencies?.originFetch ?? ((originRequest) => fetch(originRequest));
  const cache = dependencies?.cache ?? (await caches.open('retire-plan-edge-static'));
  const eligibleForCache = isStaticGet(request);
  const key = eligibleForCache ? cacheKey(request, origins.canonical) : null;

  if (key) {
    try {
      const cached = await cache.match(key);
      if (cached) return responseWithRequestId(cached, requestId);
    } catch {
      structuredError('edge_cache_read_error', request, requestId);
    }
  }

  let upstream: Response;
  try {
    upstream = await originFetch(originRequest(request, env, origins.origin, requestId));
  } catch {
    structuredError('origin_transport_error', request, requestId);
    const failure = new Response('Bad gateway', {
      status: 502,
      headers: { 'Cloudflare-CDN-Cache-Control': NO_STORE },
    });
    return responseWithRequestId(failure, requestId);
  }

  const headers = safeResponseHeaders(upstream, origins.origin, new URL(request.url));
  const cacheable = key !== null && immutable(upstream);
  headers.set('Cloudflare-CDN-Cache-Control', cacheable ? IMMUTABLE_CACHE : NO_STORE);
  const response = new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });

  if (key && cacheable) {
    ctx.waitUntil(
      cache.put(key, response.clone()).catch(() => {
        structuredError('edge_cache_write_error', request, requestId);
      }),
    );
  }

  return responseWithRequestId(response, requestId);
}

export default {
  fetch(request, env, ctx): Promise<Response> {
    return handleRequest(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
