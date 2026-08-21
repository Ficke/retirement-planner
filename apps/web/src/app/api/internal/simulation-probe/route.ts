import { NextRequest, NextResponse } from 'next/server';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { proxyToRustService, simulationProxyError } from '@/lib/simulation-proxy';
import { monteCarloRequestSchema, SIMULATION_RATE_LIMIT } from '@/lib/simulation-request';
import { readLimitedJson } from '@/lib/validation';

/**
 * Deploy-time proof that this revision can actually compute: Next.js, the
 * validation contract, the network hop to Rust, and the wire format between the
 * two engines. Cloud Run's liveness probe only shows the container is up.
 *
 * Unauthenticated because the pipeline runs it against a candidate revision
 * before any traffic is promoted, and holds no user credentials. Two things
 * keep it off the public internet, and it is only safe while BOTH hold: the
 * edge proxy refuses to forward /api/internal/, and reaching Cloud Run directly
 * requires ORIGIN_SECRET, which the middleware demands and only the Worker
 * holds. Do not expose this path through the edge.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request.headers);
    const limited = await rateLimit(`simulation-probe:${ip}`, SIMULATION_RATE_LIMIT);
    if (!limited.success) {
      return NextResponse.json(
        { error: 'Too many probe requests. Slow down and retry shortly.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((limited.reset - Date.now()) / 1000)) } }
      );
    }

    const body = await readLimitedJson(request, 256 * 1024);
    const validation = monteCarloRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid simulation request', details: validation.error.issues.slice(0, 5) },
        { status: 400 }
      );
    }

    return await proxyToRustService(
      '/api/simulate',
      validation.data,
      30000,
      'Simulation service unavailable',
    );
  } catch (error) {
    console.error('Simulation probe error:', error);
    return (
      simulationProxyError(error, 'Simulation timeout') ??
      NextResponse.json(
        { error: 'Internal server error', details: 'Simulation probe failed' },
        { status: 500 }
      )
    );
  }
}
