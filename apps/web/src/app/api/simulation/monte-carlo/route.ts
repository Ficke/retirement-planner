import { NextRequest, NextResponse } from 'next/server';
import type { SimulationResult } from '@/domain/types';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { fetchRustService } from '@/lib/rust-service-client';
import { monteCarloRequestSchema, SIMULATION_RATE_LIMIT } from '@/lib/simulation-request';

/**
 * Proxies Monte Carlo simulation requests to the Rust service.
 *
 * Publicly reachable (anonymous mode may use cloud compute), so requests are
 * rate-limited per IP and the payload is validated/clamped before any compute
 * is spent. Nothing from the request body is persisted.
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
    const validation = monteCarloRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid simulation request', details: validation.error.issues.slice(0, 5) },
        { status: 400 }
      );
    }

    // Forward the original body (the Rust service needs fields the schema
    // doesn't model, e.g. account institution); validation above has already
    // bounded everything cost-relevant.
    const rustResponse = await fetchRustService('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!rustResponse.ok) {
      const errorText = await rustResponse.text();
      console.error(`Rust service error: ${rustResponse.status} ${errorText}`);
      return NextResponse.json(
        { error: 'Simulation service unavailable', details: `Rust service returned ${rustResponse.status}` },
        { status: 502 }
      );
    }

    const result: SimulationResult = await rustResponse.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Simulation proxy error:', error);

    if (error instanceof Error) {
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        return NextResponse.json(
          { error: 'Simulation timeout', details: 'Request took too long' },
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
      { error: 'Internal server error', details: 'Simulation failed' },
      { status: 500 }
    );
  }
}
