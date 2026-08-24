export function fmtCurrency(n: number | null | undefined, compact = false): string {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (compact) {
    if (abs >= 1_000_000) return (n < 0 ? '-' : '') + '$' + (abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2) + 'M';
    if (abs >= 1_000) return (n < 0 ? '-' : '') + '$' + (abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1) + 'k';
    return '$' + n.toFixed(0);
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

/** Axis ticks are round by construction, so trailing zeros only add noise. */
export function fmtAxisCurrency(n: number): string {
  return fmtCurrency(n, true).replace(/(\.\d*?)0+(?=[Mk]$)/, '$1').replace(/\.(?=[Mk]$)/, '');
}

export function fmtPercent(n: number | null | undefined, decimals = 0): string {
  if (n == null || isNaN(n)) return '—';
  return (n * 100).toFixed(decimals) + '%';
}

export function fmtSigned(n: number, compact = false): string {
  return (n >= 0 ? '+' : '') + fmtCurrency(n, compact);
}

/** Shared thresholds for describing a success probability. */
export function successTone(p: number): {
  label: string;
  tone: 'positive' | 'neutral' | 'warn';
} {
  if (p >= 0.95) return { label: 'High cushion', tone: 'positive' };
  if (p >= 0.9) return { label: 'Strong', tone: 'positive' };
  if (p >= 0.8) return { label: 'On track with flexibility', tone: 'neutral' };
  if (p >= 0.7) return { label: 'Needs guardrails', tone: 'warn' };
  return { label: 'At risk', tone: 'warn' };
}
