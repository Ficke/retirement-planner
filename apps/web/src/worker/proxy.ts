import {
  connectingClientIp,
  ORIGIN_SECRET_HEADER,
  ORIGINAL_HOST_HEADER,
  ORIGINAL_PROTO_HEADER,
  REQUEST_ID_HEADER,
  TRUSTED_CLIENT_IP_HEADER,
} from '@/lib/edge-headers';

const INTERNAL_PATH_PREFIX = '/api/internal/';
const NO_STORE = 'no-store';

export interface ProxyDependencies {
  originFetch(request: Request): Promise<Response>;
}

function protectedRequestHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.startsWith('cf-') ||
    lower.startsWith('forwarded') ||
    lower.startsWith('x-forwarded-') ||
    lower.startsWith('x-retire-plan-') ||
    // Never forward framework-internal routing state from a browser.
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
  const clientIp = connectingClientIp(request.headers);
  headers.set(ORIGIN_SECRET_HEADER, env.ORIGIN_SECRET);
  headers.set(ORIGINAL_HOST_HEADER, publicUrl.host);
  headers.set(ORIGINAL_PROTO_HEADER, publicUrl.protocol.slice(0, -1));
  headers.set(REQUEST_ID_HEADER, requestId);
  if (clientIp) headers.set(TRUSTED_CLIENT_IP_HEADER, clientIp);
  return headers;
}

function configuredOrigin(env: Env): URL {
  const origin = new URL(env.ORIGIN_URL);
  if (origin.protocol !== 'https:' || !env.ORIGIN_SECRET) {
    throw new Error('Invalid edge proxy configuration');
  }
  return origin;
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

// The asset store answers every other path, including the SPA shell, without
// invoking this Worker. Only run_worker_first patterns reach here.
export async function proxyToOrigin(
  request: Request,
  env: Env,
  dependencies?: ProxyDependencies,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  let origin: URL;
  try {
    origin = configuredOrigin(env);
  } catch {
    structuredError('edge_configuration_error', request, requestId);
    const failure = new Response('Internal server error', {
      status: 500,
      headers: { 'Cloudflare-CDN-Cache-Control': NO_STORE },
    });
    return responseWithRequestId(failure, requestId);
  }

  // The deploy pipeline reaches /api/internal/ on the Cloud Run URL directly,
  // where ORIGIN_SECRET gates it. Nothing behind this Worker may, so refusing
  // to forward is what keeps the unauthenticated probe off the public internet.
  if (new URL(request.url).pathname.startsWith(INTERNAL_PATH_PREFIX)) {
    const blocked = new Response('Not found', {
      status: 404,
      headers: { 'Cloudflare-CDN-Cache-Control': NO_STORE },
    });
    return responseWithRequestId(blocked, requestId);
  }

  const originFetch = dependencies?.originFetch ?? ((proxied) => fetch(proxied));

  let upstream: Response;
  try {
    upstream = await originFetch(originRequest(request, env, origin, requestId));
  } catch {
    structuredError('origin_transport_error', request, requestId);
    const failure = new Response('Bad gateway', {
      status: 502,
      headers: { 'Cloudflare-CDN-Cache-Control': NO_STORE },
    });
    return responseWithRequestId(failure, requestId);
  }

  const headers = safeResponseHeaders(upstream, origin, new URL(request.url));
  headers.set('Cloudflare-CDN-Cache-Control', NO_STORE);
  const response = new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });

  return responseWithRequestId(response, requestId);
}
