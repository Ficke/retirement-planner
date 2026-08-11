import type { NextConfig } from "next";

/**
 * Security headers applied to every response.
 *
 * These were tracked as an open item in SECURITY.md and previously unimplemented.
 * They live here rather than in middleware: Next.js emits them at the edge with
 * no per-request JS, and unlike the old middleware matcher they also cover
 * /api/* — which is where the simulation endpoints are.
 *
 * Next.js emits inline bootstrap code, so script-src currently permits inline
 * scripts. The remaining directives still close object, framing, base-URI,
 * mixed-content, and unexpected network exfiltration surfaces.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com",
  "frame-src 'self' https://*.firebaseapp.com",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  // HTTPS only. Cloud Run terminates TLS and never serves plain HTTP, so this
  // is safe to set unconditionally.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // The app is never meant to be framed — clickjacking on a page with account
  // balances and plan controls.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing in the app uses these; deny by default.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
