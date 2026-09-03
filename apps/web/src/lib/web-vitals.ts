import { type Metric, onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals';
import { trackEvent } from '@/lib/analytics';

// GA4's reporting aggregates integer event values, and CLS is a unitless
// decimal well below 1. Scaling it to thousandths keeps it legible there;
// divide by 1000 to compare against the published CLS thresholds.
function reportableValue({ name, value }: Metric): number {
  return Math.round(name === 'CLS' ? value * 1000 : value);
}

function report(metric: Metric): void {
  trackEvent(metric.name, {
    value: reportableValue(metric),
    metric_id: metric.id,
    metric_rating: metric.rating,
    metric_navigation_type: metric.navigationType,
  });
}

/**
 * Reports Core Web Vitals to Google Analytics.
 *
 * Each metric is sent once, when its value settles — on page hide for CLS and
 * INP, earlier for the load metrics — so a session produces at most one event
 * per metric. `trackEvent` drops everything when the Analytics tag is absent,
 * which is every non-production hostname.
 */
export function reportWebVitals(): void {
  onCLS(report);
  onFCP(report);
  onINP(report);
  onLCP(report);
  onTTFB(report);
}
