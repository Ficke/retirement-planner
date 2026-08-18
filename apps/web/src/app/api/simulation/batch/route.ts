import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/firebase/server';
import { rateLimit } from '@/lib/rate-limit';
import { proxyToRustService, simulationProxyError } from '@/lib/simulation-proxy';
import {
  batchRequestSchema,
  SIMULATION_PATH_RATE_LIMIT,
  SIMULATION_RATE_LIMIT,
} from '@/lib/simulation-request';
import { readLimitedJson } from '@/lib/validation';

/**
 * Proxies batch Monte Carlo requests (sensitivity sweeps) to the Rust service.
 *
 * Cloud compute is for signed-in users; anonymous sessions run the Web Worker
 * engine instead. Requests are still rate-limited per account and batch size /
 * path counts clamped before any compute is spent. Nothing from the request
 * body is persisted.
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
        { error: 'Too many simulation requests — slow down and retry shortly' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((limited.reset - Date.now()) / 1000)) } }
      );
    }

    const body = await readLimitedJson(request, 256 * 1024);
    const validation = batchRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid batch simulation request', details: validation.error.issues.slice(0, 5) },
        { status: 400 }
      );
    }
    const totalPaths = validation.data.simulations.reduce(
      (sum, simulation) => sum + simulation.config.paths,
      0,
    );
    const pathLimit = await rateLimit(
      `simulate-paths:${user.id}`,
      SIMULATION_PATH_RATE_LIMIT,
      totalPaths,
    );
    if (!pathLimit.success) {
      return NextResponse.json(
        { error: 'Simulation compute quota exceeded — retry shortly' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((pathLimit.reset - Date.now()) / 1000)) } },
      );
    }

    return await proxyToRustService(
      '/api/batch',
      validation.data,
      60000,
      'Batch simulation service unavailable',
    );
  } catch (error) {
    console.error('Batch simulation proxy error:', error);
    return (
      simulationProxyError(error, 'Batch simulation timeout') ??
      NextResponse.json(
        { error: 'Internal server error', details: 'Batch simulation failed' },
        { status: 500 }
      )
    );
  }
}
