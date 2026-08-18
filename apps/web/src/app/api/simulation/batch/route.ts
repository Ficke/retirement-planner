import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/firebase/server';
import { rateLimit } from '@/lib/rate-limit';
import { fetchRustService, RustServiceUnavailableError } from '@/lib/rust-service-client';
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

    const rustResponse = await fetchRustService('/api/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validation.data),
      signal: AbortSignal.timeout(60000),
    });

    if (!rustResponse.ok) {
      const errorText = await rustResponse.text();
      console.error(`Rust service error: ${rustResponse.status} ${errorText}`);
      return NextResponse.json(
        { error: 'Batch simulation service unavailable', details: `Rust service returned ${rustResponse.status}` },
        { status: 502 }
      );
    }

    return new NextResponse(rustResponse.body, {
      status: rustResponse.status,
      headers: { 'Content-Type': rustResponse.headers.get('content-type') ?? 'application/json' },
    });
  } catch (error) {
    console.error('Batch simulation proxy error:', error);

    if (error instanceof Error) {
      if (error instanceof RangeError) {
        return NextResponse.json({ error: error.message }, { status: 413 });
      }
      if (error instanceof SyntaxError) {
        return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
      }
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        return NextResponse.json(
          { error: 'Batch simulation timeout', details: 'Request took too long' },
          { status: 504 }
        );
      }
      if (error instanceof RustServiceUnavailableError) {
        return NextResponse.json(
          { error: 'Service unavailable', details: 'Cannot connect to simulation service' },
          { status: 503 }
        );
      }
    }

    return NextResponse.json(
      { error: 'Internal server error', details: 'Batch simulation failed' },
      { status: 500 }
    );
  }
}
