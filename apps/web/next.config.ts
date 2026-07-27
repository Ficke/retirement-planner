import type { NextConfig } from "next";

/**
 * Security headers applied to every response.
 *
 * These were tracked as an open item in SECURITY.md and previously unimplemented.
 * They live here rather than in middleware: Next.js emits them at the edge with
 * no per-request JS, and unlike the old middleware matcher they also cover
 * /api/* — which is where the simulation endpoints are.
 *
 * No CSP yet: Next.js injects inline bootstrap scripts, so a useful policy needs
 * nonce plumbing rather than a header constant.
 */
const securityHeaders = [
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
  eslint: {
    ignoreDuringBuilds: true,
  },
  output: 'standalone',
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
