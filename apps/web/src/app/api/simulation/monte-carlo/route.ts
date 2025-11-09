import { NextRequest, NextResponse } from 'next/server';
import type { RetirementPlan, SimulationResult } from '@/domain/types';

interface SimulationRequest {
  plan: RetirementPlan;
  config: {
    paths: number;
    seed: number;
    realDollars: boolean;
  };
}

const RUST_SERVICE_URL = process.env.RUST_SERVICE_URL || 'http://localhost:8081';

/**
 * Next.js API endpoint that proxies Monte Carlo simulation requests to the Rust service.
 * Provides graceful fallback and unified interface for the frontend.
 */
export async function POST(request: NextRequest) {
  try {
    const body: SimulationRequest = await request.json();
    
    // Validate request
    if (!body.plan || !body.config) {
      return NextResponse.json(
        { error: 'Invalid request: plan and config are required' },
        { status: 400 }
      );
    }

    console.log(`🦀 Proxying simulation request to Rust service: ${body.config.paths} paths`);
    
    // Forward request to Rust service
    const rustResponse = await fetch(`${RUST_SERVICE_URL}/api/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      // Add timeout for reliability
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    if (!rustResponse.ok) {
      const errorText = await rustResponse.text();
      console.error(`Rust service error: ${rustResponse.status} ${errorText}`);
      return NextResponse.json(
        { 
          error: 'Simulation service unavailable',
          details: `Rust service returned ${rustResponse.status}`
        },
        { status: 502 }
      );
    }

    const result: SimulationResult = await rustResponse.json();
    
    console.log(`✅ Rust simulation completed: ${result.successProbability.toFixed(1)}% success rate`);
    
    return NextResponse.json(result);

  } catch (error) {
    console.error('Simulation proxy error:', error);
    
    // Return structured error for frontend handling
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