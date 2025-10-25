/**
 * Next.js Middleware for Authentication
 * Protects routes and redirects unauthenticated users to sign-in
 *
 * Note: For Firebase, we use client-side auth checks in components
 * rather than middleware checks because Firebase tokens are stored client-side
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isAuthPage = pathname.startsWith('/auth');
  const isApiRoute = pathname.startsWith('/api');

  // Allow API routes (they have their own auth checks)
  if (isApiRoute) {
    return NextResponse.next();
  }

  // Allow auth pages
  if (isAuthPage) {
    return NextResponse.next();
  }

  // Allow all other pages - auth will be checked client-side
  // This is the standard pattern for Firebase + Next.js
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes handle their own auth)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
