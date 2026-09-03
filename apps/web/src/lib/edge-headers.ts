/**
 * The header names spanning the Cloudflare-to-Cloud-Run boundary.
 *
 * They live in a module with no imports so the Worker can share them without
 * pulling in `node:crypto`, which is what verifying the secret costs. Declaring
 * them on each side instead would let a rename leave the Worker sending a name
 * the origin no longer accepts — a failure no test on either side would catch.
 */
export const ORIGIN_SECRET_HEADER = 'x-retire-plan-origin-secret';
export const ORIGIN_AUTHENTICATED_HEADER = 'x-retire-plan-origin-authenticated';
export const TRUSTED_CLIENT_IP_HEADER = 'x-retire-plan-client-ip';
export const ORIGINAL_HOST_HEADER = 'x-retire-plan-original-host';
export const ORIGINAL_PROTO_HEADER = 'x-retire-plan-original-proto';
export const REQUEST_ID_HEADER = 'x-retire-plan-request-id';

/**
 * The caller's address, or null when Cloudflare supplied none.
 *
 * Only `cf-connecting-ip` is read. Cloudflare overwrites it, while
 * `x-forwarded-for` is appended to and so carries client-supplied values.
 */
export function connectingClientIp(headers: Headers): string | null {
  return headers.get('cf-connecting-ip')?.trim() || null;
}
