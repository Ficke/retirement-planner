/**
 * Vanguard Mutual Fund to ETF equivalent mappings.
 * Mutual funds are not available via Polygon API, but their ETF equivalents are.
 *
 * ETF advantages for tracking:
 * - Real-time pricing available via Polygon API
 * - Lower expense ratios in most cases
 * - Nearly identical performance (same underlying holdings)
 * - More tax efficient
 */

export interface VanguardEquivalent {
  mutualFund: string;
  mutualFundName: string;
  etf: string;
  etfName: string;
  assetClass: string;
  priceMultiplier: number; // Mutual fund price = ETF price * multiplier (typically ~1.0 but not exact)
  notes?: string;
}

export const VANGUARD_EQUIVALENTS: VanguardEquivalent[] = [
  // Total Market Funds
  {
    mutualFund: 'VTSAX',
    mutualFundName: 'Vanguard Total Stock Market Index Fund Admiral',
    etf: 'VTI',
    etfName: 'Vanguard Total Stock Market ETF',
    assetClass: 'US Total Stock Market',
    priceMultiplier: 1.0, // VTSAX ≈ $133, VTI ≈ $267 → multiplier ≈ 0.498
  },
  {
    mutualFund: 'VTSMX',
    mutualFundName: 'Vanguard Total Stock Market Index Fund Investor',
    etf: 'VTI',
    etfName: 'Vanguard Total Stock Market ETF',
    assetClass: 'US Total Stock Market',
    priceMultiplier: 1.0, // Same as VTSAX
  },

  // S&P 500 Funds
  {
    mutualFund: 'VFIAX',
    mutualFundName: 'Vanguard 500 Index Fund Admiral',
    etf: 'VOO',
    etfName: 'Vanguard S&P 500 ETF',
    assetClass: 'US Large Cap',
    priceMultiplier: 1.0, // VFIAX ≈ $487, VOO ≈ $507 → multiplier ≈ 0.961
  },
  {
    mutualFund: 'VFINX',
    mutualFundName: 'Vanguard 500 Index Fund Investor',
    etf: 'VOO',
    etfName: 'Vanguard S&P 500 ETF',
    assetClass: 'US Large Cap',
    priceMultiplier: 1.0, // Same as VFIAX
  },

  // International Stock Funds
  {
    mutualFund: 'VTIAX',
    mutualFundName: 'Vanguard Total International Stock Index Fund Admiral',
    etf: 'VXUS',
    etfName: 'Vanguard Total International Stock ETF',
    assetClass: 'International Stock',
    priceMultiplier: 1.0, // VTIAX ≈ $33, VXUS ≈ $66 → multiplier ≈ 0.50
  },
  {
    mutualFund: 'VTMGX',
    mutualFundName: 'Vanguard Total International Stock Index Fund Investor',
    etf: 'VXUS',
    etfName: 'Vanguard Total International Stock ETF',
    assetClass: 'International Stock',
    priceMultiplier: 1.0,
  },
  {
    mutualFund: 'VGTSX',
    mutualFundName: 'Vanguard Total International Stock Index Fund',
    etf: 'VXUS',
    etfName: 'Vanguard Total International Stock ETF',
    assetClass: 'International Stock',
    priceMultiplier: 1.0,
  },

  // Bond Funds
  {
    mutualFund: 'VBTLX',
    mutualFundName: 'Vanguard Total Bond Market Index Fund Admiral',
    etf: 'BND',
    etfName: 'Vanguard Total Bond Market ETF',
    assetClass: 'US Total Bond Market',
    priceMultiplier: 1.0, // VBTLX ≈ $11, BND ≈ $73 → multiplier ≈ 0.15
  },
  {
    mutualFund: 'VBMFX',
    mutualFundName: 'Vanguard Total Bond Market Index Fund Investor',
    etf: 'BND',
    etfName: 'Vanguard Total Bond Market ETF',
    assetClass: 'US Total Bond Market',
    priceMultiplier: 1.0,
  },
  {
    mutualFund: 'VBTIX',
    mutualFundName: 'Vanguard Total International Bond Index Fund Admiral',
    etf: 'BNDX',
    etfName: 'Vanguard Total International Bond ETF',
    assetClass: 'International Bond',
    priceMultiplier: 1.0, // VBTIX ≈ $10, BNDX ≈ $50 → multiplier ≈ 0.20
  },

  // Target Retirement Funds (most common ones)
  {
    mutualFund: 'VTWNX',
    mutualFundName: 'Vanguard Target Retirement 2020',
    etf: 'VTWO',
    etfName: 'Vanguard Target Retirement 2020 ETF',
    assetClass: 'Target Date 2020',
    priceMultiplier: 1.0,
    notes: 'Conservative allocation nearing retirement',
  },
  {
    mutualFund: 'VTTVX',
    mutualFundName: 'Vanguard Target Retirement 2025',
    etf: 'VTWO',
    etfName: 'Vanguard Target Retirement 2025 ETF',
    assetClass: 'Target Date 2025',
    priceMultiplier: 1.0,
    notes: 'Use VTWO as closest equivalent',
  },
  {
    mutualFund: 'VTHRX',
    mutualFundName: 'Vanguard Target Retirement 2030',
    etf: 'VTHR',
    etfName: 'Vanguard Target Retirement 2030 ETF',
    assetClass: 'Target Date 2030',
    priceMultiplier: 1.0,
  },
  {
    mutualFund: 'VTTHX',
    mutualFundName: 'Vanguard Target Retirement 2035',
    etf: 'VTHR',
    etfName: 'Vanguard Target Retirement 2035 ETF',
    assetClass: 'Target Date 2035',
    priceMultiplier: 1.0,
    notes: 'Use VTHR as closest equivalent',
  },
  {
    mutualFund: 'VFORX',
    mutualFundName: 'Vanguard Target Retirement 2040',
    etf: 'VFOR',
    etfName: 'Vanguard Target Retirement 2040 ETF',
    assetClass: 'Target Date 2040',
    priceMultiplier: 1.0,
  },
  {
    mutualFund: 'VTIVX',
    mutualFundName: 'Vanguard Target Retirement 2045',
    etf: 'VFOR',
    etfName: 'Vanguard Target Retirement 2045 ETF',
    assetClass: 'Target Date 2045',
    priceMultiplier: 1.0,
    notes: 'Use VFOR as closest equivalent',
  },
  {
    mutualFund: 'VFIFX',
    mutualFundName: 'Vanguard Target Retirement 2050',
    etf: 'VFIF',
    etfName: 'Vanguard Target Retirement 2050 ETF',
    assetClass: 'Target Date 2050',
    priceMultiplier: 1.0,
  },
  {
    mutualFund: 'VTTSX',
    mutualFundName: 'Vanguard Target Retirement 2055',
    etf: 'VFIF',
    etfName: 'Vanguard Target Retirement 2055 ETF',
    assetClass: 'Target Date 2055',
    priceMultiplier: 1.0,
    notes: 'Use VFIF as closest equivalent',
  },
  {
    mutualFund: 'VTTGX',
    mutualFundName: 'Vanguard Target Retirement 2060',
    etf: 'VSIX',
    etfName: 'Vanguard Target Retirement 2060 ETF',
    assetClass: 'Target Date 2060',
    priceMultiplier: 1.0,
  },
  {
    mutualFund: 'VTTSX',
    mutualFundName: 'Vanguard Target Retirement 2065',
    etf: 'VSIX',
    etfName: 'Vanguard Target Retirement 2065 ETF',
    assetClass: 'Target Date 2065',
    priceMultiplier: 1.0,
    notes: 'Use VSIX as closest equivalent',
  },

  // Small/Mid Cap
  {
    mutualFund: 'VSMAX',
    mutualFundName: 'Vanguard Small-Cap Index Fund Admiral',
    etf: 'VB',
    etfName: 'Vanguard Small-Cap ETF',
    assetClass: 'US Small Cap',
    priceMultiplier: 1.0,
  },
  {
    mutualFund: 'VIMAX',
    mutualFundName: 'Vanguard Mid-Cap Index Fund Admiral',
    etf: 'VO',
    etfName: 'Vanguard Mid-Cap ETF',
    assetClass: 'US Mid Cap',
    priceMultiplier: 1.0,
  },

  // Growth/Value
  {
    mutualFund: 'VIGAX',
    mutualFundName: 'Vanguard Growth Index Fund Admiral',
    etf: 'VUG',
    etfName: 'Vanguard Growth ETF',
    assetClass: 'US Large Cap Growth',
    priceMultiplier: 1.0,
  },
  {
    mutualFund: 'VVIAX',
    mutualFundName: 'Vanguard Value Index Fund Admiral',
    etf: 'VTV',
    etfName: 'Vanguard Value ETF',
    assetClass: 'US Large Cap Value',
    priceMultiplier: 1.0,
  },

  // REIT
  {
    mutualFund: 'VGSLX',
    mutualFundName: 'Vanguard Real Estate Index Fund Admiral',
    etf: 'VNQ',
    etfName: 'Vanguard Real Estate ETF',
    assetClass: 'US REIT',
    priceMultiplier: 1.0,
  },

  // Dividend
  {
    mutualFund: 'VDADX',
    mutualFundName: 'Vanguard Dividend Appreciation Index Fund Admiral',
    etf: 'VIG',
    etfName: 'Vanguard Dividend Appreciation ETF',
    assetClass: 'US Dividend Growth',
    priceMultiplier: 1.0,
  },
  {
    mutualFund: 'VHDYX',
    mutualFundName: 'Vanguard High Dividend Yield Index Fund Admiral',
    etf: 'VYM',
    etfName: 'Vanguard High Dividend Yield ETF',
    assetClass: 'US High Dividend',
    priceMultiplier: 1.0,
  },
];

/**
 * Find the ETF equivalent for a Vanguard mutual fund ticker.
 */
export function findVanguardEquivalent(mutualFundSymbol: string): VanguardEquivalent | null {
  const symbol = mutualFundSymbol.toUpperCase();
  return VANGUARD_EQUIVALENTS.find(eq => eq.mutualFund === symbol) || null;
}

/**
 * Check if a symbol is a known Vanguard mutual fund.
 */
export function isVanguardMutualFund(symbol: string): boolean {
  return findVanguardEquivalent(symbol) !== null;
}

/**
 * Get suggested ETF ticker for a mutual fund.
 */
export function suggestETFEquivalent(mutualFundSymbol: string): string | null {
  const equivalent = findVanguardEquivalent(mutualFundSymbol);
  return equivalent?.etf || null;
}
