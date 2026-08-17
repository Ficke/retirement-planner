import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest, type EdgeCache, type ProxyDependencies } from '../src/index';

const testEnv = {
  ORIGIN_URL: 'https://retire-plan-lvs5yigt4a-uc.a.run.app',
  CANONICAL_ORIGIN: 'https://adamficke.dev',
  ORIGIN_SECRET: 'local-test-origin-secret',
} satisfies Env;

class MemoryCache implements EdgeCache {
  readonly entries = new Map<string, Response>();
  matchCalls = 0;
  putCalls = 0;

  async match(request: Request): Promise<Response | undefined> {
    this.matchCalls += 1;
    return this.entries.get(request.url)?.clone();
  }

  async put(request: Request, response: Response): Promise<void> {
    this.putCalls += 1;
    this.entries.set(request.url, response.clone());
  }
}

function dependencies(
  originFetch: ProxyDependencies['originFetch'],
  cache = new MemoryCache(),
): ProxyDependencies & { cache: MemoryCache } {
  return { originFetch, cache };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('edge proxy', () => {
  it('fails closed and disables caching when required configuration is missing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const missingSecretEnv = { ...testEnv, ORIGIN_SECRET: '' } satisfies Env;
    const response = await handleRequest(
      new Request('https://adamficke.dev/'),
      missingSecretEnv,
      createExecutionContext(),
      dependencies(async () => new Response('must not be called')),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe('no-store');
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it('uses the configured origin and replaces spoofable forwarding headers', async () => {
    let observedUrl = '';
    let observedHeaders = new Headers();
    const deps = dependencies(async (request) => {
      observedUrl = request.url;
      observedHeaders = new Headers(request.headers);
      return new Response('ok');
    });
    const ctx = createExecutionContext();

    const response = await handleRequest(
      new Request('https://staging.adamficke.dev/api/profile?view=full', {
        headers: {
          'cf-connecting-ip': '203.0.113.9',
          'x-forwarded-for': '1.2.3.4',
          'x-real-ip': '5.6.7.8',
          'x-retire-plan-origin-secret': 'spoofed',
          'x-retire-plan-client-ip': '9.9.9.9',
        },
      }),
      testEnv,
      ctx,
      deps,
    );

    expect(response.status).toBe(200);
    expect(observedUrl).toBe(`${testEnv.ORIGIN_URL}/api/profile?view=full`);
    expect(observedHeaders.get('x-retire-plan-origin-secret')).toBe(testEnv.ORIGIN_SECRET);
    expect(observedHeaders.get('x-retire-plan-client-ip')).toBe('203.0.113.9');
    expect(observedHeaders.get('x-retire-plan-original-host')).toBe('staging.adamficke.dev');
    expect(observedHeaders.get('x-retire-plan-original-proto')).toBe('https');
    expect(observedHeaders.has('x-forwarded-for')).toBe(false);
    expect(observedHeaders.has('x-real-ip')).toBe(false);
    expect(observedHeaders.has('cf-connecting-ip')).toBe(false);
    expect(observedHeaders.get('x-retire-plan-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('streams non-GET request bodies and performs exactly one manual origin fetch', async () => {
    let calls = 0;
    let method = '';
    let redirect: RequestRedirect | undefined;
    let body = '';
    const deps = dependencies(async (request) => {
      calls += 1;
      method = request.method;
      redirect = request.redirect;
      body = await request.text();
      return new Response('streamed response');
    });

    const response = await handleRequest(
      new Request('https://adamficke.dev/api/simulation/monte-carlo', {
        method: 'POST',
        body: 'request-stream',
      }),
      testEnv,
      createExecutionContext(),
      deps,
    );

    expect(calls).toBe(1);
    expect(method).toBe('POST');
    expect(redirect).toBe('manual');
    expect(body).toBe('request-stream');
    expect(await response.text()).toBe('streamed response');
  });

  it('returns the upstream response before its body stream closes', async () => {
    const stream = new TransformStream<Uint8Array, Uint8Array>();
    const writer = stream.writable.getWriter();
    const response = await handleRequest(
      new Request('https://adamficke.dev/api/simulation/batch'),
      testEnv,
      createExecutionContext(),
      dependencies(async () => new Response(stream.readable)),
    );

    const body = response.text();
    await writer.write(new TextEncoder().encode('first'));
    await writer.write(new TextEncoder().encode('-second'));
    await writer.close();
    expect(await body).toBe('first-second');
  });

  it('rewrites only absolute redirects back to the configured origin', async () => {
    const originRedirect = dependencies(async () =>
      new Response(null, {
        status: 302,
        headers: { location: `${testEnv.ORIGIN_URL}/auth/signin?next=%2Fplan` },
      }),
    );
    const response = await handleRequest(
      new Request('https://staging.adamficke.dev/private'),
      testEnv,
      createExecutionContext(),
      originRedirect,
    );
    expect(response.headers.get('location')).toBe(
      'https://staging.adamficke.dev/auth/signin?next=%2Fplan',
    );

    const externalRedirect = dependencies(async () =>
      new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/' } }),
    );
    const external = await handleRequest(
      new Request('https://adamficke.dev/auth'),
      testEnv,
      createExecutionContext(),
      externalRedirect,
    );
    expect(external.headers.get('location')).toBe('https://accounts.google.com/');
  });

  it('caches only successful immutable Next static GET responses', async () => {
    let originCalls = 0;
    const deps = dependencies(async () => {
      originCalls += 1;
      return new Response('asset', {
        headers: { 'cache-control': 'public, max-age=31536000, immutable' },
      });
    });
    const request = new Request('https://staging.adamficke.dev/_next/static/chunks/app.abc.js');
    const firstCtx = createExecutionContext();
    const first = await handleRequest(request, testEnv, firstCtx, deps);
    await waitOnExecutionContext(firstCtx);
    expect(first.headers.get('Cloudflare-CDN-Cache-Control')).toContain('immutable');
    expect(deps.cache.putCalls).toBe(1);

    const second = await handleRequest(request, testEnv, createExecutionContext(), deps);
    expect(await second.text()).toBe('asset');
    expect(originCalls).toBe(1);
    expect(deps.cache.matchCalls).toBe(2);
    expect(
      deps.cache.entries.has(`${testEnv.CANONICAL_ORIGIN}/_next/static/chunks/app.abc.js`),
    ).toBe(
      true,
    );
  });

  it('marks HTML, APIs, redirects, errors, HEAD, and non-immutable assets no-store', async () => {
    const cases: Array<[string, RequestInit | undefined, number, HeadersInit | undefined]> = [
      ['https://adamficke.dev/', undefined, 200, undefined],
      ['https://adamficke.dev/api/profile', undefined, 200, undefined],
      ['https://adamficke.dev/redirect', undefined, 302, { location: '/target' }],
      ['https://adamficke.dev/error', undefined, 500, undefined],
      ['https://adamficke.dev/_next/static/chunks/app.js', { method: 'HEAD' }, 200, undefined],
      ['https://adamficke.dev/_next/static/chunks/app.js', undefined, 200, { 'cache-control': 'max-age=60' }],
    ];

    for (const [url, init, status, headers] of cases) {
      const deps = dependencies(async () => new Response(status === 302 ? null : 'body', { status, headers }));
      const response = await handleRequest(
        new Request(url, init),
        testEnv,
        createExecutionContext(),
        deps,
      );
      expect(response.headers.get('Cloudflare-CDN-Cache-Control'), url).toBe('no-store');
      expect(deps.cache.putCalls, url).toBe(0);
    }
  });

  it('returns a generic 502 and logs no origin, IP, or secret on transport failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await handleRequest(
      new Request('https://adamficke.dev/api/profile', {
        headers: { 'cf-connecting-ip': '203.0.113.9' },
      }),
      testEnv,
      createExecutionContext(),
      dependencies(async () => {
        throw new Error('connection to secret origin failed');
      }),
    );

    expect(response.status).toBe(502);
    expect(await response.text()).toBe('Bad gateway');
    const logged = consoleError.mock.calls.flat().join(' ');
    expect(logged).not.toContain(testEnv.ORIGIN_URL);
    expect(logged).not.toContain(testEnv.ORIGIN_SECRET);
    expect(logged).not.toContain('203.0.113.9');
  });
});
