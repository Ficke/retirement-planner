/**
 * Mutual Fund Mapping Service
 *
 * Transparently maps mutual fund symbols to their ETF equivalents for pricing.
 * Allows users to track mutual fund holdings while using ETF prices from Polygon API.
 *
 * Key principle: Mutual funds and their ETF equivalents track the same underlying
 * index with identical NAV calculations, so price ratios are essentially 1:1.
 */

import { findVanguardEquivalent, isVanguardMutualFund } from '@/data/vanguard-equivalents';

export interface MutualFundInfo {
  isMutualFund: boolean;
  originalSymbol: string;
  pricingSymbol: string; // Symbol to use for price lookups
  displayName?: string;
  equivalentETF?: string;
  etfName?: string;
}

/**
 * Get pricing information for a symbol, automatically mapping mutual funds to ETFs.
 *
 * @param symbol - Original symbol (could be mutual fund or ETF)
 * @returns Info about how to price this symbol
 */
export function getMutualFundInfo(symbol: string): MutualFundInfo {
  const upperSymbol = symbol.toUpperCase();

  // Check if it's a known Vanguard mutual fund
  const equivalent = findVanguardEquivalent(upperSymbol);

  if (equivalent) {
    return {
      isMutualFund: true,
      originalSymbol: upperSymbol,
      pricingSymbol: equivalent.etf, // Use ETF for pricing
      displayName: equivalent.mutualFundName,
      equivalentETF: equivalent.etf,
      etfName: equivalent.etfName,
    };
  }

  // Not a mutual fund, use symbol as-is
  return {
    isMutualFund: false,
    originalSymbol: upperSymbol,
    pricingSymbol: upperSymbol,
  };
}

/**
 * Convert an ETF price to the equivalent mutual fund price.
 * Since Vanguard mutual funds and ETFs track identical indices with the same NAV,
 * the price ratio is effectively 1:1 (minor differences due to timing of NAV calc).
 *
 * @param etfPrice - Price of the ETF
 * @param mutualFundSymbol - Mutual fund symbol
 * @returns Equivalent mutual fund price
 */
export function convertETFPriceToMutualFund(etfPrice: number, mutualFundSymbol: string): number {
  const equivalent = findVanguardEquivalent(mutualFundSymbol);

  if (!equivalent) {
    // Not a known mutual fund, return price as-is
    return etfPrice;
  }

  // Use the multiplier from the mapping table
  // For most Vanguard funds, this is 1.0 since they track identically
  return etfPrice * equivalent.priceMultiplier;
}

/**
 * Check if a symbol should display a "mutual fund" indicator in the UI.
 */
export function shouldShowMutualFundIndicator(symbol: string): boolean {
  return isVanguardMutualFund(symbol);
}

/**
 * Get display symbol with mutual fund indicator if applicable.
 *
 * @param symbol - Original symbol
 * @returns Display string (e.g., "VTIAX (MF)" or just "VTI")
 */
export function getDisplaySymbol(symbol: string): string {
  const info = getMutualFundInfo(symbol);

  if (info.isMutualFund) {
    return `${info.originalSymbol} (MF)`;
  }

  return info.originalSymbol;
}

/**
 * Get tooltip text explaining the mutual fund mapping.
 */
export function getMutualFundTooltip(symbol: string): string | null {
  const info = getMutualFundInfo(symbol);

  if (!info.isMutualFund || !info.equivalentETF) {
    return null;
  }

  return `Mutual fund priced using ${info.equivalentETF} (${info.etfName}). Both track the same index with identical performance.`;
}
