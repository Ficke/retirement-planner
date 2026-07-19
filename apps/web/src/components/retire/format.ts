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
  if (p >= 0.85) return { label: 'Excellent', tone: 'positive' };
  if (p >= 0.7) return { label: 'On track', tone: 'neutral' };
  if (p >= 0.5) return { label: 'At risk', tone: 'warn' };
  return { label: 'Off track', tone: 'warn' };
}
