import { NextRequest, NextResponse } from 'next/server';
import {
  ORIGIN_SECRET_HEADER,
  sanitizedOriginHeaders,
  verifyOriginSecret,
} from '@/lib/origin-auth';

export function middleware(request: NextRequest): NextResponse {
  const isHealthCheck = request.nextUrl.pathname === '/healthz';
  const expectedSecret = process.env.ORIGIN_SECRET ?? '';

  if (isHealthCheck) {
    return NextResponse.next({
      request: { headers: sanitizedOriginHeaders(request.headers, false) },
    });
  }

  if (!expectedSecret) {
    if (process.env.NODE_ENV === 'production') {
      return new NextResponse('Service unavailable', { status: 503 });
    }

    return NextResponse.next({
      request: { headers: sanitizedOriginHeaders(request.headers, false) },
    });
  }

  const authenticated = verifyOriginSecret(
    request.headers.get(ORIGIN_SECRET_HEADER),
    expectedSecret,
  );
  if (!authenticated) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  return NextResponse.next({
    request: { headers: sanitizedOriginHeaders(request.headers, true) },
  });
}

export const config = {
  matcher: '/:path*',
  runtime: 'nodejs',
};
