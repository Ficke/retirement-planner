import { describe, it, expect } from 'vitest';
import { getClientIp } from '@/lib/rate-limit';
import {
  ORIGIN_AUTHENTICATED_HEADER,
  TRUSTED_CLIENT_IP_HEADER,
} from '@/lib/origin-auth';

const authenticatedHeaders = (clientIp?: string) =>
  new Headers({
    [ORIGIN_AUTHENTICATED_HEADER]: '1',
    ...(clientIp == null ? {} : { [TRUSTED_CLIENT_IP_HEADER]: clientIp }),
  });

describe('getClientIp', () => {
  it('uses the Worker-supplied address after origin authentication', () => {
    expect(getClientIp(authenticatedHeaders('203.0.113.9'))).toBe('203.0.113.9');
    expect(getClientIp(authenticatedHeaders('2001:db8::1'))).toBe('2001:db8::1');
  });

  it('does not trust the private header without the internal authentication marker', () => {
    expect(getClientIp(new Headers({ [TRUSTED_CLIENT_IP_HEADER]: '203.0.113.9' }))).toBe(
      'unknown',
    );
  });

  it('does not trust public forwarding headers', () => {
    expect(
      getClientIp(
        new Headers({
          'x-forwarded-for': '203.0.113.9',
          'x-real-ip': '203.0.113.10',
          [ORIGIN_AUTHENTICATED_HEADER]: '1',
        }),
      ),
    ).toBe('unknown');
  });

  it('rejects malformed and compound private addresses', () => {
    expect(getClientIp(authenticatedHeaders('1.2.3.4, 5.6.7.8'))).toBe('unknown');
    expect(getClientIp(authenticatedHeaders('not-an-ip'))).toBe('unknown');
    expect(getClientIp(authenticatedHeaders(''))).toBe('unknown');
  });
});
