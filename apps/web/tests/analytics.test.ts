import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bootstrapPath = resolve(import.meta.dirname, '../public/analytics-bootstrap.js');
const indexPath = resolve(import.meta.dirname, '../index.html');

function loadAnalyticsBootstrap(url: string) {
  const bootstrap = readFileSync(bootstrapPath, 'utf8');
  const dom = new JSDOM(`<!doctype html><head><script>${bootstrap}</script></head>`, {
    runScripts: 'dangerously',
    url,
  });

  return dom.window;
}

describe('Google Analytics bootstrap', () => {
  it('runs from the document head before the application bundle', () => {
    const index = readFileSync(indexPath, 'utf8');

    expect(index.indexOf('/analytics-bootstrap.js')).toBeGreaterThan(-1);
    expect(index.indexOf('/analytics-bootstrap.js')).toBeLessThan(index.indexOf('/src/main.tsx'));
  });

  it('loads and configures the production tag with automatic page views enabled', () => {
    const window = loadAnalyticsBootstrap('https://adamficke.dev/plan');
    const dataLayer = window.dataLayer as Array<ArrayLike<unknown>>;
    const commands = dataLayer.map((command) => Array.from(command));

    expect(
      window.document.querySelector(
        'script[src="https://www.googletagmanager.com/gtag/js?id=G-Q998L3MV0B"]',
      ),
    ).not.toBeNull();
    expect(commands[0]?.[0]).toBe('js');
    expect(commands[1]).toEqual(['config', 'G-Q998L3MV0B']);
  });

  it('supports explicit DebugView sessions without enabling debug mode for normal traffic', () => {
    const window = loadAnalyticsBootstrap('https://adamficke.dev/?analytics_debug=1');
    const dataLayer = window.dataLayer as Array<ArrayLike<unknown>>;
    const commands = dataLayer.map((command) => Array.from(command));

    expect(commands[1]).toEqual(['config', 'G-Q998L3MV0B', { debug_mode: true }]);
  });

  it('does not load Analytics outside the production hostnames', () => {
    const window = loadAnalyticsBootstrap('http://localhost:3000/');

    expect(window.gtag).toBeUndefined();
    expect(window.document.querySelector('script[src*="googletagmanager.com/gtag/js"]')).toBeNull();
  });
});

describe('Analytics events', () => {
  beforeEach(() => {
    vi.resetModules();
    delete window.gtag;
    delete window.dataLayer;
  });

  it('sets stable user context and attaches it to later events', async () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    const { setAnalyticsUserStatus, trackEvent } = await import('@/lib/analytics');

    setAnalyticsUserStatus('signed_in');
    setAnalyticsUserStatus('signed_in');
    trackEvent('login', { method: 'google' });

    expect(gtag.mock.calls).toEqual([
      ['set', 'user_properties', { user_status: 'signed_in' }],
      ['event', 'login', { method: 'google', user_status: 'signed_in' }],
    ]);
  });

  it('sets User-ID after sign-in and clears it after sign-out', async () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    const { setAnalyticsUserId } = await import('@/lib/analytics');

    setAnalyticsUserId(null);
    setAnalyticsUserId('account-123');
    setAnalyticsUserId('account-123');
    setAnalyticsUserId(null);

    expect(gtag.mock.calls).toEqual([
      ['set', { user_id: 'account-123' }],
      ['set', { user_id: null }],
    ]);
  });
});

describe('Web Vitals reporting', () => {
  beforeEach(() => {
    vi.resetModules();
    delete window.gtag;
    delete window.dataLayer;
  });

  async function collectMetric(metric: Record<string, unknown>) {
    const gtag = vi.fn();
    window.gtag = gtag;

    const listeners: Array<(value: unknown) => void> = [];
    const capture = (listener: (value: unknown) => void) => listeners.push(listener);
    vi.doMock('web-vitals', () => ({
      onCLS: capture,
      onFCP: capture,
      onINP: capture,
      onLCP: capture,
      onTTFB: capture,
    }));

    const { reportWebVitals } = await import('@/lib/web-vitals');
    reportWebVitals();
    expect(listeners).toHaveLength(5);

    listeners[0]?.(metric);
    return gtag.mock.calls;
  }

  it('sends a metric as a named event with an integer value', async () => {
    const calls = await collectMetric({
      name: 'LCP',
      value: 1843.7,
      id: 'v5-1',
      rating: 'good',
      navigationType: 'navigate',
    });

    expect(calls).toEqual([
      [
        'event',
        'LCP',
        {
          value: 1844,
          metric_id: 'v5-1',
          metric_rating: 'good',
          metric_navigation_type: 'navigate',
        },
      ],
    ]);
  });

  // CLS below 1 would round to 0 and every session would look perfect.
  it('scales CLS to thousandths so it survives integer rounding', async () => {
    const calls = await collectMetric({
      name: 'CLS',
      value: 0.0834,
      id: 'v5-2',
      rating: 'needs-improvement',
      navigationType: 'navigate',
    });

    expect(calls[0]?.[2]).toMatchObject({ value: 83 });
  });

  it('stays silent when the Analytics tag never loaded', async () => {
    const listeners: Array<(value: unknown) => void> = [];
    vi.doMock('web-vitals', () => {
      const capture = (listener: (value: unknown) => void) => listeners.push(listener);
      return { onCLS: capture, onFCP: capture, onINP: capture, onLCP: capture, onTTFB: capture };
    });

    const { reportWebVitals } = await import('@/lib/web-vitals');
    reportWebVitals();

    expect(() =>
      listeners[0]?.({ name: 'LCP', value: 1, id: 'v5-3', rating: 'good', navigationType: 'navigate' }),
    ).not.toThrow();
  });
});
