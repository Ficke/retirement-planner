import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyToOrigin, type ProxyDependencies } from '@/worker/proxy';

// Only the proxy's own bindings matter here; the data routes are exercised
// against their dependencies in tests/api.
const testEnv = {
  ORIGIN_URL: 'https://retire-plan-lvs5yigt4a-uc.a.run.app',
  ORIGIN_SECRET: 'local-test-origin-secret',
} as unknown as Env;

function dependencies(originFetch: ProxyDependencies['originFetch']): ProxyDependencies {
  return { originFetch };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('edge worker', () => {
  it('fails closed when required configuration is missing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const missingSecretEnv = { ...testEnv, ORIGIN_SECRET: '' } as Env;
    const response = await proxyToOrigin(
      new Request('https://adamficke.dev/api/profile'),
      missingSecretEnv,
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

    const response = await proxyToOrigin(
      new Request('https://staging.adamficke.dev/api/profile?view=full', {
        headers: {
          'cf-connecting-ip': '203.0.113.9',
          'x-forwarded-for': '1.2.3.4',
          'x-real-ip': '5.6.7.8',
          'x-retire-plan-origin-secret': 'spoofed',
          'x-retire-plan-client-ip': '9.9.9.9',
          'x-middleware-subrequest': 'middleware',
        },
      }),
      testEnv,
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
    expect(observedHeaders.has('x-middleware-subrequest')).toBe(false);
    expect(observedHeaders.get('x-retire-plan-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('removes headers identifying the origin stack', async () => {
    const deps = dependencies(
      async () =>
        new Response('ok', {
          headers: {
            'x-powered-by': 'origin-runtime',
            server: 'Google Frontend',
            'x-cloud-trace-context': 'abc/123',
          },
        }),
    );

    const response = await proxyToOrigin(
      new Request('https://staging.adamficke.dev/api/profile'),
      testEnv,
      deps,
    );

    expect(response.headers.has('x-powered-by')).toBe(false);
    expect(response.headers.has('server')).toBe(false);
    expect(response.headers.has('x-cloud-trace-context')).toBe(false);
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

    const response = await proxyToOrigin(
      new Request('https://adamficke.dev/api/simulation/monte-carlo', {
        method: 'POST',
        body: 'request-stream',
      }),
      testEnv,
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
    const response = await proxyToOrigin(
      new Request('https://adamficke.dev/api/simulation/batch'),
      testEnv,
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
    const response = await proxyToOrigin(
      new Request('https://staging.adamficke.dev/api/private'),
      testEnv,
      originRedirect,
    );
    expect(response.headers.get('location')).toBe(
      'https://staging.adamficke.dev/auth/signin?next=%2Fplan',
    );

    const externalRedirect = dependencies(async () =>
      new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/' } }),
    );
    const external = await proxyToOrigin(
      new Request('https://adamficke.dev/api/auth'),
      testEnv,
      externalRedirect,
    );
    expect(external.headers.get('location')).toBe('https://accounts.google.com/');
  });

  it('refuses to forward internal paths, so the deploy probe stays unreachable', async () => {
    const originFetch = vi.fn(async () => new Response('should never be reached'));

    const response = await proxyToOrigin(
      new Request('https://adamficke.dev/api/internal/simulation-probe', { method: 'POST', body: '{}' }),
      testEnv,
      dependencies(originFetch),
    );

    expect(response.status).toBe(404);
    expect(originFetch).not.toHaveBeenCalled();
    expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe('no-store');
  });

  it('still forwards the public simulation routes', async () => {
    const originFetch = vi.fn(async () => new Response('{}', { status: 401 }));

    const response = await proxyToOrigin(
      new Request('https://adamficke.dev/api/simulation/monte-carlo', { method: 'POST', body: '{}' }),
      testEnv,
      dependencies(originFetch),
    );

    expect(originFetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(401);
  });

  // Assets are served by the asset store and never reach the Worker, so every
  // response it produces is a dynamic origin response.
  it('marks every proxied response no-store', async () => {
    const cases: Array<[string, RequestInit | undefined, number, HeadersInit | undefined]> = [
      ['https://adamficke.dev/api/profile', undefined, 200, undefined],
      ['https://adamficke.dev/api/redirect', undefined, 302, { location: '/target' }],
      ['https://adamficke.dev/api/error', undefined, 500, undefined],
      ['https://adamficke.dev/api/accounts', { method: 'HEAD' }, 200, undefined],
      [
        'https://adamficke.dev/api/profile',
        undefined,
        200,
        { 'cache-control': 'public, max-age=31536000, immutable' },
      ],
    ];

    for (const [url, init, status, headers] of cases) {
      const deps = dependencies(async () =>
        new Response(status === 302 ? null : 'body', { status, headers }),
      );
      const response = await proxyToOrigin(new Request(url, init), testEnv, deps);
      expect(response.headers.get('Cloudflare-CDN-Cache-Control'), url).toBe('no-store');
    }
  });

  it('returns a generic 502 and logs no origin, IP, or secret on transport failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await proxyToOrigin(
      new Request('https://adamficke.dev/api/profile', {
        headers: { 'cf-connecting-ip': '203.0.113.9' },
      }),
      testEnv,
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
