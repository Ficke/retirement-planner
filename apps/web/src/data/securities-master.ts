/**
 * Securities master database containing common ETFs, mutual funds, and stocks
 * with their underlying asset allocations for risk calculation.
 *
 * This enables proper risk modeling for leveraged funds like NTSX
 * while maintaining accurate portfolio values.
 */

import type { Security } from '@/domain/types';

export const SECURITIES_MASTER: Record<string, Security> = {
  // Broad Market ETFs
  'VTI': {
    symbol: 'VTI',
    name: 'Vanguard Total Stock Market ETF',
    type: 'ETF',
    assetClass: 'STOCK',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 1.0,
      bonds: 0.0,
    },
    expenseRatio: 0.0003,
    provider: 'Vanguard',
  },
  'VXUS': {
    symbol: 'VXUS',
    name: 'Vanguard Total International Stock ETF',
    type: 'ETF',
    assetClass: 'STOCK',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 1.0,
      bonds: 0.0,
    },
    expenseRatio: 0.0008,
    provider: 'Vanguard',
  },
  'IVV': {
    symbol: 'IVV',
    name: 'iShares Core S&P 500 ETF',
    type: 'ETF',
    assetClass: 'STOCK',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 1.0,
      bonds: 0.0,
    },
    expenseRatio: 0.0003,
    provider: 'iShares',
  },
  'SCHE': {
    symbol: 'SCHE',
    name: 'Schwab Emerging Markets Equity ETF',
    type: 'ETF',
    assetClass: 'STOCK',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 1.0,
      bonds: 0.0,
    },
    expenseRatio: 0.0011,
    provider: 'Schwab',
  },
  'IEFA': {
    symbol: 'IEFA',
    name: 'iShares Core MSCI EAFE ETF',
    type: 'ETF',
    assetClass: 'STOCK',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 1.0,
      bonds: 0.0,
    },
    expenseRatio: 0.0007,
    provider: 'iShares',
  },
  'VTWO': {
    symbol: 'VTWO',
    name: 'Vanguard Russell 2000 ETF',
    type: 'ETF',
    assetClass: 'STOCK',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 1.0,
      bonds: 0.0,
    },
    expenseRatio: 0.0010,
    provider: 'Vanguard',
  },
  'BND': {
    symbol: 'BND',
    name: 'Vanguard Total Bond Market ETF',
    type: 'ETF',
    assetClass: 'BOND',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 0.0,
      bonds: 1.0,
    },
    expenseRatio: 0.0003,
    provider: 'Vanguard',
  },
  'BNDX': {
    symbol: 'BNDX',
    name: 'Vanguard Total International Bond ETF',
    type: 'ETF',
    assetClass: 'BOND',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 0.0,
      bonds: 1.0,
    },
    expenseRatio: 0.0007,
    provider: 'Vanguard',
  },

  // Leveraged/Composite Funds
  'NTSX': {
    symbol: 'NTSX',
    name: 'WisdomTree 90/60 U.S. Balanced Fund',
    type: 'ETF',
    assetClass: 'OTHER', // Mixed/leveraged
    riskMultiplier: 1.5, // 150% total exposure
    underlyingAllocations: {
      stocks: 0.90, // 90% stock exposure
      bonds: 0.60, // 60% bond exposure
    },
    expenseRatio: 0.0020,
    provider: 'WisdomTree',
  },
  'NTSI': {
    symbol: 'NTSI',
    name: 'WisdomTree 90/60 U.S. Balanced Fund - Currency Hedged',
    type: 'ETF',
    assetClass: 'OTHER',
    riskMultiplier: 1.5,
    underlyingAllocations: {
      stocks: 0.90,
      bonds: 0.60,
    },
    expenseRatio: 0.0028,
    provider: 'WisdomTree',
  },

  // Vanguard Mutual Funds (priced via Yahoo Finance NAV)
  'VTSAX': {
    symbol: 'VTSAX',
    name: 'Vanguard Total Stock Market Index Fund Admiral Shares',
    type: 'MUTUAL_FUND',
    assetClass: 'STOCK',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 1.0,
      bonds: 0.0,
    },
    expenseRatio: 0.0003,
    provider: 'Vanguard',
  },
  'VTIAX': {
    symbol: 'VTIAX',
    name: 'Vanguard Total International Stock Index Fund Admiral Shares',
    type: 'MUTUAL_FUND',
    assetClass: 'STOCK',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 1.0,
      bonds: 0.0,
    },
    expenseRatio: 0.0005,
    provider: 'Vanguard',
  },
  'VBTLX': {
    symbol: 'VBTLX',
    name: 'Vanguard Total Bond Market Index Fund Admiral Shares',
    type: 'MUTUAL_FUND',
    assetClass: 'BOND',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 0.0,
      bonds: 1.0,
    },
    expenseRatio: 0.0003,
    provider: 'Vanguard',
  },

  // Vanguard Institutional Shares
  'VIVIX': {
    symbol: 'VIVIX',
    name: 'Vanguard Value Index Fund Institutional Shares',
    type: 'MUTUAL_FUND',
    assetClass: 'STOCK',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 1.0,
      bonds: 0.0,
    },
    expenseRatio: 0.0004,
    provider: 'Vanguard',
  },
  'VIGIX': {
    symbol: 'VIGIX',
    name: 'Vanguard Growth Index Fund Institutional Shares',
    type: 'MUTUAL_FUND',
    assetClass: 'STOCK',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 1.0,
      bonds: 0.0,
    },
    expenseRatio: 0.0004,
    provider: 'Vanguard',
  },
  'VINIX': {
    symbol: 'VINIX',
    name: 'Vanguard Institutional 500 Index Trust',
    type: 'MUTUAL_FUND',
    assetClass: 'STOCK',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 1.0,
      bonds: 0.0,
    },
    expenseRatio: 0.0003,
    provider: 'Vanguard',
  },
  'VIIIX': {
    symbol: 'VIIIX',
    name: 'Vanguard Institutional 500 Index Trust',
    type: 'MUTUAL_FUND',
    assetClass: 'STOCK',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 1.0,
      bonds: 0.0,
    },
    expenseRatio: 0.0003,
    provider: 'Vanguard',
  },
  'VTSNX': {
    symbol: 'VTSNX',
    name: 'Vanguard Institutional Total International Stock Market Index Trust',
    type: 'MUTUAL_FUND',
    assetClass: 'STOCK',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 1.0,
      bonds: 0.0,
    },
    expenseRatio: 0.0006,
    provider: 'Vanguard',
  },
  'VIPSX': {
    symbol: 'VIPSX',
    name: 'Vanguard Inflation-Protected Securities Fund Institutional Shares',
    type: 'MUTUAL_FUND',
    assetClass: 'BOND',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 0.0,
      bonds: 1.0,
    },
    expenseRatio: 0.0004,
    provider: 'Vanguard',
  },
  'VBMPX': {
    symbol: 'VBMPX',
    name: 'Vanguard Institutional Total Bond Market Index Trust',
    type: 'MUTUAL_FUND',
    assetClass: 'BOND',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 0.0,
      bonds: 1.0,
    },
    expenseRatio: 0.0003,
    provider: 'Vanguard',
  },
  'VTRLX': {
    symbol: 'VTRLX',
    name: 'Vanguard Target Retirement 2055 Trust Select',
    type: 'MUTUAL_FUND',
    assetClass: 'OTHER',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 0.90, // Approximate for 2055 target date
      bonds: 0.10,
    },
    expenseRatio: 0.0009,
    provider: 'Vanguard',
  },
  'VFFSX': {
    symbol: 'VFFSX',
    name: 'Vanguard 500 Index Fund Institutional Plus Shares',
    type: 'MUTUAL_FUND',
    assetClass: 'STOCK',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 1.0,
      bonds: 0.0,
    },
    expenseRatio: 0.0002,
    provider: 'Vanguard',
  },
  'VBTIX': {
    symbol: 'VBTIX',
    name: 'Vanguard Institutional Total Bond Market Ix Tr',
    type: 'MUTUAL_FUND',
    assetClass: 'BOND',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 0.0,
      bonds: 1.0,
    },
    expenseRatio: 0.00035,
    provider: 'Vanguard',
  },
  'VFFVX': {
    symbol: 'VFFVX',
    name: 'Vanguard Target Retirement 2055 Fund',
    type: 'MUTUAL_FUND',
    assetClass: 'OTHER',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 0.90, // Approximate for 2055 target date
      bonds: 0.10,
    },
    expenseRatio: 0.0008,
    provider: 'Vanguard',
  },

  // Popular Index Funds
  'SPY': {
    symbol: 'SPY',
    name: 'SPDR S&P 500 ETF Trust',
    type: 'ETF',
    assetClass: 'STOCK',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 1.0,
      bonds: 0.0,
    },
    expenseRatio: 0.0945,
    provider: 'State Street',
  },
  'VOO': {
    symbol: 'VOO',
    name: 'Vanguard S&P 500 ETF',
    type: 'ETF',
    assetClass: 'STOCK',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 1.0,
      bonds: 0.0,
    },
    expenseRatio: 0.0003,
    provider: 'Vanguard',
  },

  // Target Date Funds (example - approximate allocations, priced via Yahoo Finance)
  'VTTSX': {
    symbol: 'VTTSX',
    name: 'Vanguard Target Retirement 2060 Fund',
    type: 'MUTUAL_FUND',
    assetClass: 'OTHER',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 0.90, // Approximate for 2060 target date
      bonds: 0.10,
    },
    expenseRatio: 0.0008,
    provider: 'Vanguard',
  },

  // REITs
  'VNQ': {
    symbol: 'VNQ',
    name: 'Vanguard Real Estate ETF',
    type: 'ETF',
    assetClass: 'REIT',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 0.0,
      bonds: 0.0,
      reit: 1.0,
    },
    expenseRatio: 0.0012,
    provider: 'Vanguard',
  },

  // Cash/Money Market
  'VMOT': {
    symbol: 'VMOT',
    name: 'Vanguard Ultra-Short-Term Bond ETF',
    type: 'ETF',
    assetClass: 'CASH',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 0.0,
      bonds: 0.0,
      cash: 1.0,
    },
    expenseRatio: 0.0010,
    provider: 'Vanguard',
  },
  'VUSXX': {
    symbol: 'VUSXX',
    name: 'Vanguard Treasury Money Market Fund',
    type: 'MUTUAL_FUND',
    assetClass: 'CASH',
    riskMultiplier: 1.0,
    underlyingAllocations: {
      stocks: 0.0,
      bonds: 0.0,
      cash: 1.0,
    },
    expenseRatio: 0.0009,
    provider: 'Vanguard',
  },
};

/**
 * Get security information by symbol
 */
export function getSecurity(symbol: string): Security | null {
  return SECURITIES_MASTER[symbol.toUpperCase()] || null;
}

/**
 * Search securities by name or symbol
 */
export function searchSecurities(query: string): Security[] {
  const queryLower = query.toLowerCase();
  return Object.values(SECURITIES_MASTER).filter(security =>
    security.symbol.toLowerCase().includes(queryLower) ||
    security.name.toLowerCase().includes(queryLower)
  );
}

/**
 * Get all available securities
 */
export function getAllSecurities(): Security[] {
  return Object.values(SECURITIES_MASTER);
}

/**
 * Calculate effective asset allocation for a security position
 * Handles leveraged funds correctly by using underlying allocations
 */
export function calculateEffectiveAllocation(security: Security, value: number): {
  stocks: number;
  bonds: number;
  cash: number;
  reit: number;
  other: number;
} {
  return {
    stocks: value * (security.underlyingAllocations.stocks || 0),
    bonds: value * (security.underlyingAllocations.bonds || 0),
    cash: value * (security.underlyingAllocations.cash || 0),
    reit: value * (security.underlyingAllocations.reit || 0),
    other: value * (security.underlyingAllocations.other || 0),
  };
}

/**
 * Validate that a security's allocations are consistent with its risk multiplier
 */
export function validateSecurityAllocations(security: Security): { isValid: boolean; error?: string } {
  const allocations = security.underlyingAllocations;
  const totalAllocation = (allocations.stocks || 0) +
                         (allocations.bonds || 0) +
                         (allocations.cash || 0) +
                         (allocations.commodity || 0) +
                         (allocations.reit || 0) +
                         (allocations.other || 0);

  const tolerance = 0.01; // 1% tolerance for rounding
  if (Math.abs(totalAllocation - security.riskMultiplier) > tolerance) {
    return {
      isValid: false,
      error: `Security ${security.symbol}: Total allocation ${totalAllocation.toFixed(3)} does not match risk multiplier ${security.riskMultiplier}`,
    };
  }

  return { isValid: true };
}