import { describe, expect, it } from 'vitest';
import {
  ORIGIN_AUTHENTICATED_HEADER,
  ORIGIN_SECRET_HEADER,
  TRUSTED_CLIENT_IP_HEADER,
  originSecretCandidates,
  sanitizedOriginHeaders,
  verifyOriginSecret,
} from '@/lib/origin-auth';

describe('verifyOriginSecret', () => {
  it('accepts only an exact non-empty secret', () => {
    expect(verifyOriginSecret('correct horse battery staple', 'correct horse battery staple')).toBe(
      true,
    );
    expect(verifyOriginSecret('correct horse battery stapler', 'correct horse battery staple')).toBe(
      false,
    );
    expect(verifyOriginSecret(null, 'expected')).toBe(false);
    expect(verifyOriginSecret('', '')).toBe(false);
  });

  it('accepts either secret while a rotation pair is configured', () => {
    expect(verifyOriginSecret('incoming', 'incoming', 'outgoing')).toBe(true);
    expect(verifyOriginSecret('outgoing', 'incoming', 'outgoing')).toBe(true);
    expect(verifyOriginSecret('retired', 'incoming', 'outgoing')).toBe(false);
  });

  it('ignores an empty previous secret', () => {
    expect(originSecretCandidates('current', '')).toEqual(['current']);
    expect(originSecretCandidates('', '')).toEqual([]);
    expect(verifyOriginSecret('', 'current', '')).toBe(false);
  });
});

describe('sanitizedOriginHeaders', () => {
  it('removes the secret and replaces a spoofed authentication marker', () => {
    const headers = sanitizedOriginHeaders(
      new Headers({
        [ORIGIN_SECRET_HEADER]: 'never-forward-this',
        [ORIGIN_AUTHENTICATED_HEADER]: 'spoofed',
        [TRUSTED_CLIENT_IP_HEADER]: '203.0.113.9',
      }),
      true,
    );

    expect(headers.has(ORIGIN_SECRET_HEADER)).toBe(false);
    expect(headers.get(ORIGIN_AUTHENTICATED_HEADER)).toBe('1');
    expect(headers.get(TRUSTED_CLIENT_IP_HEADER)).toBe('203.0.113.9');
  });

  it('removes all private trust headers when unauthenticated', () => {
    const headers = sanitizedOriginHeaders(
      new Headers({
        [ORIGIN_SECRET_HEADER]: 'secret',
        [ORIGIN_AUTHENTICATED_HEADER]: '1',
        [TRUSTED_CLIENT_IP_HEADER]: '203.0.113.9',
      }),
      false,
    );

    expect(headers.has(ORIGIN_SECRET_HEADER)).toBe(false);
    expect(headers.has(ORIGIN_AUTHENTICATED_HEADER)).toBe(false);
    expect(headers.has(TRUSTED_CLIENT_IP_HEADER)).toBe(false);
  });
});
