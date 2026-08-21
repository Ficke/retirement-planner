import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/firebase/server';
import { rateLimit } from '@/lib/rate-limit';
import { proxyToRustService, simulationProxyError } from '@/lib/simulation-proxy';
import {
  monteCarloRequestSchema,
  SIMULATION_PATH_RATE_LIMIT,
  SIMULATION_RATE_LIMIT,
} from '@/lib/simulation-request';
import { readLimitedJson } from '@/lib/validation';

/**
 * Proxies Monte Carlo simulation requests to the Rust service.
 *
 * Cloud compute is for signed-in users; anonymous sessions run the Web Worker
 * engine instead. Requests are still rate-limited per account and the payload
 * validated/clamped before any compute is spent. Nothing from the request body
 * is persisted.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const limited = await rateLimit(`simulate:${user.id}`, SIMULATION_RATE_LIMIT);
    if (!limited.success) {
      return NextResponse.json(
        { error: 'Too many simulation requests. Slow down and retry shortly.' },
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
    const pathLimit = await rateLimit(
      `simulate-paths:${user.id}`,
      SIMULATION_PATH_RATE_LIMIT,
      validation.data.config.paths,
    );
    if (!pathLimit.success) {
      return NextResponse.json(
        { error: 'Simulation compute quota exceeded. Retry shortly.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((pathLimit.reset - Date.now()) / 1000)) } },
      );
    }

    return await proxyToRustService(
      '/api/simulate',
      validation.data,
      30000,
      'Simulation service unavailable',
    );
  } catch (error) {
    console.error('Simulation proxy error:', error);
    return (
      simulationProxyError(error, 'Simulation timeout') ??
      NextResponse.json(
        { error: 'Internal server error', details: 'Simulation failed' },
        { status: 500 }
      )
    );
  }
}
