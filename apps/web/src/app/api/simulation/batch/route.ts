import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { fetchRustService } from '@/lib/rust-service-client';
import { batchRequestSchema, SIMULATION_RATE_LIMIT } from '@/lib/simulation-request';

/**
 * Proxies batch Monte Carlo requests (sensitivity sweeps) to the Rust service.
 *
 * Publicly reachable (anonymous mode may use cloud compute), so requests are
 * rate-limited per IP and batch size / path counts are clamped before any
 * compute is spent. Nothing from the request body is persisted.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request.headers);
    const limited = await rateLimit(`simulate:${ip}`, SIMULATION_RATE_LIMIT);
    if (!limited.success) {
      return NextResponse.json(
        { error: 'Too many simulation requests — slow down and retry shortly' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((limited.reset - Date.now()) / 1000)) } }
      );
    }

    const body = await request.json();
    const validation = batchRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid batch simulation request', details: validation.error.issues.slice(0, 5) },
        { status: 400 }
      );
    }

    const rustResponse = await fetchRustService('/api/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

    const result = await rustResponse.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Batch simulation proxy error:', error);

    if (error instanceof Error) {
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        return NextResponse.json(
          { error: 'Batch simulation timeout', details: 'Request took too long' },
          { status: 504 }
        );
      }
      if (error.message.includes('fetch')) {
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
