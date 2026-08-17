import { createHash, timingSafeEqual } from 'node:crypto';

export const ORIGIN_SECRET_HEADER = 'x-retire-plan-origin-secret';
export const TRUSTED_CLIENT_IP_HEADER = 'x-retire-plan-client-ip';
export const ORIGIN_AUTHENTICATED_HEADER = 'x-retire-plan-origin-authenticated';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function verifyOriginSecret(provided: string | null, expected: string): boolean {
  if (!provided || !expected) return false;
  return timingSafeEqual(digest(provided), digest(expected));
}

export function sanitizedOriginHeaders(headers: Headers, authenticated: boolean): Headers {
  const sanitized = new Headers(headers);
  sanitized.delete(ORIGIN_SECRET_HEADER);
  sanitized.delete(ORIGIN_AUTHENTICATED_HEADER);

  if (authenticated) {
    sanitized.set(ORIGIN_AUTHENTICATED_HEADER, '1');
  } else {
    sanitized.delete(TRUSTED_CLIENT_IP_HEADER);
  }

  return sanitized;
}
