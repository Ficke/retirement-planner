type AnalyticsEventParameters = Record<string, boolean | number | string>;
export type AnalyticsUserStatus = 'guest' | 'signed_in';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let userStatus: AnalyticsUserStatus | null = null;
let userId: string | null | undefined;

function sendAnalyticsCommand(...args: unknown[]) {
  window.gtag?.(...args);
}

export function setAnalyticsUserStatus(status: AnalyticsUserStatus) {
  if (!window.gtag || userStatus === status) return;

  userStatus = status;
  sendAnalyticsCommand('set', 'user_properties', { user_status: status });
}

export function setAnalyticsUserId(nextUserId: string | null) {
  if (!window.gtag || userId === nextUserId) return;
  if (userId === undefined && nextUserId === null) return;

  userId = nextUserId;
  sendAnalyticsCommand('set', { user_id: nextUserId });
}

export function trackEvent(name: string, parameters: AnalyticsEventParameters = {}) {
  if (!window.gtag) return;

  sendAnalyticsCommand('event', name, {
    ...parameters,
    ...(userStatus && { user_status: userStatus }),
  });
}
