import { createHash, timingSafeEqual } from 'node:crypto';

/** Brute-force budget per IP for signup attempts that need a code. */
export const INVITE_RATE_LIMIT = { limit: 10, windowMs: 60 * 60 * 1000 };

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function inviteCodes(): string[] {
  return (process.env.SIGNUP_INVITE_CODES ?? '')
    .split(',')
    .map((code) => code.trim())
    .filter((code) => code.length > 0);
}

// No codes configured closes signup entirely, in every environment. An invite
// gate that opens itself when misconfigured is not a gate.
export function verifyInviteCode(provided: unknown): boolean {
  if (typeof provided !== 'string' || provided.length === 0) return false;

  const providedDigest = digest(provided);
  return inviteCodes().reduce(
    (matched, code) => timingSafeEqual(providedDigest, digest(code)) || matched,
    false,
  );
}
