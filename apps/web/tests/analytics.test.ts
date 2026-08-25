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
