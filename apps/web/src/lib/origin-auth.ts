import { createHash, timingSafeEqual } from 'node:crypto';

export const ORIGIN_SECRET_HEADER = 'x-retire-plan-origin-secret';
export const TRUSTED_CLIENT_IP_HEADER = 'x-retire-plan-client-ip';
export const ORIGIN_AUTHENTICATED_HEADER = 'x-retire-plan-origin-authenticated';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

// Accepting the outgoing secret alongside the incoming one lets the Worker and
// Cloud Run be updated in either order during a rotation, instead of every
// request failing closed in the window between the two updates.
export function originSecretCandidates(current: string, previous = ''): string[] {
  return [current, previous].filter((candidate) => candidate.length > 0);
}

export function verifyOriginSecret(
  provided: string | null,
  current: string,
  previous = '',
): boolean {
  if (!provided) return false;
  const providedDigest = digest(provided);
  return originSecretCandidates(current, previous).reduce(
    (matched, candidate) => timingSafeEqual(providedDigest, digest(candidate)) || matched,
    false,
  );
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
