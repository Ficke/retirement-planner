import { fetchRustService, RustServiceUnavailableError } from '@/lib/rust-service-client';

/**
 * Forward a validated simulation payload to the Rust service and stream the
 * answer back untouched.
 */
export async function proxyToRustService(
  path: string,
  payload: unknown,
  timeoutMs: number,
  unavailableLabel: string,
): Promise<Response> {
  const rustResponse = await fetchRustService(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!rustResponse.ok) {
    const errorText = await rustResponse.text();
    console.error(`Rust service error: ${rustResponse.status} ${errorText}`);
    return Response.json(
      { error: unavailableLabel, details: `Rust service returned ${rustResponse.status}` },
      { status: 502 }
    );
  }

  return new Response(rustResponse.body, {
    status: rustResponse.status,
    headers: { 'Content-Type': rustResponse.headers.get('content-type') ?? 'application/json' },
  });
}

/**
 * Map a proxy failure onto the status the smoke check reads to tell the modes
 * apart: 413 oversized, 400 malformed, 504 timeout, 503 Rust unreachable.
 * Null means the cause is unrecognized and belongs in a 500.
 */
export function simulationProxyError(error: unknown, timeoutLabel: string): Response | null {
  if (!(error instanceof Error)) return null;

  if (error instanceof RangeError) {
    return Response.json({ error: error.message }, { status: 413 });
  }
  if (error instanceof SyntaxError) {
    return Response.json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }
  if (error.name === 'AbortError' || error.message.includes('timeout')) {
    return Response.json(
      { error: timeoutLabel, details: 'Request took too long' },
      { status: 504 }
    );
  }
  if (error instanceof RustServiceUnavailableError) {
    return Response.json(
      { error: 'Service unavailable', details: 'Cannot connect to simulation service' },
      { status: 503 }
    );
  }
  return null;
}
