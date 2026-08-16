import { describe, it, expect } from 'vitest';
import { getClientIp } from '@/lib/rate-limit';

const ipFor = (forwardedFor?: string) =>
  getClientIp(new Headers(forwardedFor == null ? {} : { 'x-forwarded-for': forwardedFor }));

describe('getClientIp', () => {
  it('uses the address Cloud Run appends when the client sent no header', () => {
    expect(ipFor('203.0.113.9')).toBe('203.0.113.9');
  });

  it('ignores an address the client supplied ahead of the appended one', () => {
    // A client that sends its own x-forwarded-for previously chose its own
    // rate-limit bucket, because the second-to-last entry was trusted.
    expect(ipFor('1.2.3.4, 203.0.113.9')).toBe('203.0.113.9');
    expect(ipFor('1.2.3.4, 5.6.7.8, 203.0.113.9')).toBe('203.0.113.9');
  });

  it('does not put separate callers in one shared bucket', () => {
    expect(ipFor('203.0.113.9')).not.toBe(ipFor('203.0.113.10'));
    expect(ipFor('203.0.113.9')).not.toBe('unknown');
  });

  it('tolerates whitespace and empty entries', () => {
    expect(ipFor(' 1.2.3.4 ,  203.0.113.9 ')).toBe('203.0.113.9');
    expect(ipFor('1.2.3.4, ,203.0.113.9')).toBe('203.0.113.9');
  });

  it('falls back to a shared bucket only when there is nothing to key on', () => {
    expect(ipFor()).toBe('unknown');
    expect(ipFor('')).toBe('unknown');
    expect(ipFor('   ')).toBe('unknown');
  });

  it('does not trust x-real-ip, which a client can set', () => {
    expect(getClientIp(new Headers({ 'x-real-ip': '1.2.3.4' }))).toBe('unknown');
  });
});
