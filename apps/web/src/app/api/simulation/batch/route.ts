import { NextRequest, NextResponse } from 'next/server';
import type { RetirementPlan, SimulationResult } from '@/domain/types';

interface BatchSimulationRequest {
  id: string;
  plan: RetirementPlan;
  config: {
    paths: number;
    seed: number;
    realDollars: boolean;
  };
}

interface BatchSimulationResponse {
  id: string;
  result: SimulationResult;
}

interface BatchRequest {
  simulations: BatchSimulationRequest[];
}

interface BatchResponse {
  results: BatchSimulationResponse[];
}

const RUST_SERVICE_URL = process.env.RUST_SERVICE_URL || 'http://localhost:8081';

/**
 * Next.js API endpoint that proxies batch Monte Carlo simulation requests to the Rust service.
 * Allows multiple simulations to be processed in a single HTTP request for better performance.
 */
export async function POST(request: NextRequest) {
  try {
    const body: BatchRequest = await request.json();

    // Validate request
    if (!body.simulations || !Array.isArray(body.simulations) || body.simulations.length === 0) {
      return NextResponse.json(
        { error: 'Invalid request: simulations array is required' },
        { status: 400 }
      );
    }

    const totalPaths = body.simulations.reduce((sum, sim) => sum + sim.config.paths, 0);
    console.log(`🦀 Proxying batch simulation request to Rust service: ${body.simulations.length} simulations, ${totalPaths} total paths`);

    // Forward request to Rust service
    const rustResponse = await fetch(`${RUST_SERVICE_URL}/api/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      // Increase timeout for batch requests
      signal: AbortSignal.timeout(60000), // 60 second timeout
    });

    if (!rustResponse.ok) {
      const errorText = await rustResponse.text();
      console.error(`Rust service error: ${rustResponse.status} ${errorText}`);
      return NextResponse.json(
        {
          error: 'Batch simulation service unavailable',
          details: `Rust service returned ${rustResponse.status}`
        },
        { status: 502 }
      );
    }

    const result: BatchResponse = await rustResponse.json();

    console.log(`✅ Rust batch simulation completed: ${result.results.length} simulations processed`);

    return NextResponse.json(result);

  } catch (error) {
    console.error('Batch simulation proxy error:', error);

    // Return structured error for frontend handling
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
