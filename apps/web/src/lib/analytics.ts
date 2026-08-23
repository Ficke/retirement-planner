const GOOGLE_ANALYTICS_MEASUREMENT_ID = 'G-Q998L3MV0B';
const ANALYTICS_HOSTNAMES = new Set(['adamficke.dev', 'www.adamficke.dev']);

type AnalyticsEventParameters = Record<string, boolean | number | string>;
export type AnalyticsUserStatus = 'guest' | 'signed_in';

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}

let initialized = false;
let userStatus: AnalyticsUserStatus | null = null;
let userId: string | null | undefined;

export function initializeAnalytics() {
  if (initialized || !ANALYTICS_HOSTNAMES.has(window.location.hostname)) return;

  initialized = true;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = (...args: unknown[]) => {
    window.dataLayer.push(args);
  };

  window.gtag('js', new Date());
  window.gtag('config', GOOGLE_ANALYTICS_MEASUREMENT_ID, { send_page_view: false });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ANALYTICS_MEASUREMENT_ID}`;
  document.head.append(script);
}

export function trackPageView() {
  if (!initialized) return;

  window.gtag('event', 'page_view', {
    page_location: `${window.location.origin}${window.location.pathname}`,
    page_title: document.title,
    ...(userStatus && { user_status: userStatus }),
  });
}

export function setAnalyticsUserStatus(status: AnalyticsUserStatus) {
  if (!initialized || userStatus === status) return;

  userStatus = status;
  window.gtag('set', 'user_properties', { user_status: status });
}

export function setAnalyticsUserId(nextUserId: string | null) {
  if (!initialized || userId === nextUserId) return;
  if (userId === undefined && nextUserId === null) return;

  userId = nextUserId;
  window.gtag('set', 'user_id', nextUserId);
}

export function trackEvent(name: string, parameters: AnalyticsEventParameters = {}) {
  if (!initialized) return;

  window.gtag('event', name, {
    ...parameters,
    ...(userStatus && { user_status: userStatus }),
  });
}
