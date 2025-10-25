/**
 * Market data service that integrates with Polygon.io API
 * Provides real-time and historical market data for securities
 * Stores all fetched data in persistent database for future reference
 */

import { getUnifiedDatabaseService } from './database';
import { getMostRecentBusinessDay } from '@/lib/utils';

interface PolygonTickerDetails {
  ticker: string;
  name: string;
  market: string;
  locale: string;
  primary_exchange: string;
  type: string;
  active: boolean;
  currency_name: string;
  cik?: string;
  composite_figi?: string;
  share_class_figi?: string;
  market_cap?: number;
  phone_number?: string;
  address?: {
    address1?: string;
    city?: string;
    state?: string;
    postal_code?: string;
  };
  description?: string;
  sic_code?: string;
  sic_description?: string;
  ticker_root?: string;
  homepage_url?: string;
  total_employees?: number;
  list_date?: string;
  branding?: {
    logo_url?: string;
    icon_url?: string;
  };
  share_class_shares_outstanding?: number;
  weighted_shares_outstanding?: number;
}

interface PolygonQuote {
  ticker: string;
  last?: {
    price: number;
    timestamp: number;
  };
  market_status: string;
  fmv?: number;
}

interface PolygonAggregateBar {
  c: number; // close price
  h: number; // high price
  l: number; // low price
  o: number; // open price
  t: number; // timestamp
  v: number; // volume
  vw: number; // volume weighted average price
  n: number; // number of transactions
}

interface PolygonAggregateResponse {
  ticker: string;
  status: string;
  adjusted: boolean;
  queryCount: number;
  resultsCount: number;
  results?: PolygonAggregateBar[];
  next_url?: string;
}

export interface SecurityQuote {
  symbol: string;
  price: number;
  timestamp: Date;
  marketStatus: 'open' | 'closed' | 'extended_hours';
}

export interface SecurityDetails {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  active: boolean;
  currency: string;
  marketCap?: number;
  description?: string;
  logoUrl?: string;
}

export interface HistoricalPrice {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PriceAtDate {
  symbol: string;
  date: Date;
  price: number;
}

export interface MarketDataService {
  getQuote(symbol: string): Promise<SecurityQuote>;
  getQuotes(symbols: string[]): Promise<SecurityQuote[]>;
  getSecurityDetails(symbol: string): Promise<SecurityDetails>;
  getHistoricalPrices(symbol: string, fromDate: Date, toDate: Date): Promise<HistoricalPrice[]>;
  searchTickers(query: string): Promise<SecurityDetails[]>;

  // Optimized methods for catch-up calculations
  getPriceAtDate(symbol: string, date: Date): Promise<number>;
  getBatchPricesAtDates(requests: Array<{ symbol: string; date: Date }>): Promise<PriceAtDate[]>;
  getLatestPrices(symbols: string[]): Promise<Record<string, number>>;

  // Enhanced batch methods for efficient API usage
  getMonthlyPrices(symbol: string, year: number, month: number): Promise<HistoricalPrice[]>;
  getBatchMonthlyPrices(requests: Array<{ symbol: string; year: number; month: number }>): Promise<Record<string, HistoricalPrice[]>>;
}

interface CachedPrice {
  price: number;
  timestamp: number;
  expiry: number;
  isHistorical: boolean; // Flag to distinguish historical vs current prices
  source: 'api' | 'fallback'; // Track data source for debugging
}

class PolygonMarketDataService implements MarketDataService {
  private apiKey: string;
  private baseUrl = 'https://api.polygon.io';
  private rateLimitPerMinute: number;
  private lastRequestTimes: number[] = [];

  // In-memory cache for performance (database is primary storage)
  private priceCache = new Map<string, CachedPrice>();
  private readonly HISTORICAL_CACHE_TTL = 365 * 24 * 60 * 60 * 1000; // 1 year for historical data
  private readonly CURRENT_PRICE_TTL = 15 * 60 * 1000; // 15 minutes for current prices
  private readonly CACHE_STORAGE_KEY = 'polygon_price_cache';
  private readonly CACHE_VERSION = 'v2'; // Version to handle cache format changes
  private saveTimeoutId: NodeJS.Timeout | null = null;

  constructor(apiKey: string, rateLimitPerMinute: number = 5) {
    this.apiKey = apiKey;
    this.rateLimitPerMinute = rateLimitPerMinute;
    this.loadCacheFromStorage();
    this.initializeDatabase();
  }

  private async initializeDatabase(): Promise<void> {
    try {
      const db = getUnifiedDatabaseService();
      await db.initialize();
      console.log('📊 Market data service: Database initialized');
    } catch (error) {
      console.error('Failed to initialize database for market data service:', error);
    }
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;

    // Remove requests older than 1 minute
    this.lastRequestTimes = this.lastRequestTimes.filter(time => time > oneMinuteAgo);

    // If we're at the rate limit, wait
    if (this.lastRequestTimes.length >= this.rateLimitPerMinute) {
      const oldestRequest = this.lastRequestTimes[0];
      const waitTime = (oldestRequest + 60 * 1000) - now + 100; // Add 100ms buffer
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    // Record this request
    this.lastRequestTimes.push(now);
  }

  private async makeRequest<T>(endpoint: string, params: Record<string, string> = {}, retryCount = 0): Promise<T> {
    const maxRetries = 3;
    const baseDelay = 1000; // 1 second

    await this.enforceRateLimit();

    const url = new URL(`${this.baseUrl}${endpoint}`);
    url.searchParams.set('apikey', this.apiKey);

    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    const response = await fetch(url.toString());

    // Handle rate limiting with exponential backoff
    if (response.status === 429) {
      if (retryCount < maxRetries) {
        const delay = baseDelay * Math.pow(2, retryCount); // Exponential backoff: 1s, 2s, 4s
        console.warn(`⏳ Rate limited by Polygon API, retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.makeRequest<T>(endpoint, params, retryCount + 1);
      }
      throw new Error(`Polygon API rate limit exceeded after ${maxRetries} retries`);
    }

    if (!response.ok) {
      throw new Error(`Polygon API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getQuote(symbol: string): Promise<SecurityQuote> {
    const data = await this.makeRequest<PolygonQuote>(`/v2/last/nbbo/${symbol.toUpperCase()}`);

    return {
      symbol: symbol.toUpperCase(),
      price: data.last?.price || data.fmv || 0,
      timestamp: data.last ? new Date(data.last.timestamp / 1000000) : new Date(),
      marketStatus: this.mapMarketStatus(data.market_status),
    };
  }

  async getQuotes(symbols: string[]): Promise<SecurityQuote[]> {
    // For free tier, we need to make individual requests due to rate limits
    const quotes: SecurityQuote[] = [];

    for (const symbol of symbols) {
      try {
        const quote = await this.getQuote(symbol);
        quotes.push(quote);
      } catch (error) {
        console.warn(`Failed to get quote for ${symbol}:`, error);
        // Return a default quote with 0 price if API fails
        quotes.push({
          symbol: symbol.toUpperCase(),
          price: 0,
          timestamp: new Date(),
          marketStatus: 'closed',
        });
      }
    }

    return quotes;
  }

  async getSecurityDetails(symbol: string): Promise<SecurityDetails> {
    const data = await this.makeRequest<PolygonTickerDetails>(`/v3/reference/tickers/${symbol.toUpperCase()}`);

    return {
      symbol: data.ticker,
      name: data.name,
      exchange: data.primary_exchange || 'Unknown',
      type: data.type,
      active: data.active,
      currency: data.currency_name || 'USD',
      marketCap: data.market_cap,
      description: data.description,
      logoUrl: data.branding?.logo_url,
    };
  }

  async getHistoricalPrices(symbol: string, fromDate: Date, toDate: Date): Promise<HistoricalPrice[]> {
    const from = fromDate.toISOString().split('T')[0];
    const to = toDate.toISOString().split('T')[0];

    const data = await this.makeRequest<PolygonAggregateResponse>(
      `/v2/aggs/ticker/${symbol.toUpperCase()}/range/1/day/${from}/${to}`,
      { adjusted: 'true' }
    );

    if (!data.results) {
      return [];
    }

    return data.results.map(bar => ({
      date: new Date(bar.t),
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
    }));
  }

  async searchTickers(query: string): Promise<SecurityDetails[]> {
    if (query.length < 1) {
      return [];
    }

    try {
      // Polygon's ticker search endpoint
      const data = await this.makeRequest<{ results: PolygonTickerDetails[] }>(
        '/v3/reference/tickers',
        {
          search: query,
          limit: '10',
          active: 'true',
          market: 'stocks',
        }
      );

      return (data.results || []).map(ticker => ({
        symbol: ticker.ticker,
        name: ticker.name,
        exchange: ticker.primary_exchange || 'Unknown',
        type: ticker.type,
        active: ticker.active,
        currency: ticker.currency_name || 'USD',
        marketCap: ticker.market_cap,
        description: ticker.description,
        logoUrl: ticker.branding?.logo_url,
      }));
    } catch (error) {
      console.warn('Ticker search failed:', error);
      return [];
    }
  }

  private loadCacheFromStorage(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const cached = localStorage.getItem(this.CACHE_STORAGE_KEY);
        if (cached) {
          const data = JSON.parse(cached) as Record<string, any>;

          // Load valid (non-expired) entries, handling old format
          const now = Date.now();
          Object.entries(data).forEach(([key, value]) => {
            if (value.expiry > now) {
              // Handle both old and new cache formats
              const cachedPrice: CachedPrice = {
                price: value.price,
                timestamp: value.timestamp,
                expiry: value.expiry,
                isHistorical: value.isHistorical ?? true, // Default to historical for old entries
                source: value.source ?? 'api', // Default to api for old entries
              };
              this.priceCache.set(key, cachedPrice);
            }
          });

          console.log(`Loaded ${this.priceCache.size} cached prices from storage`);
        }
      }
    } catch (error) {
      console.warn('Failed to load price cache from storage:', error);
    }
  }

  private saveCacheToStorage(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const data: Record<string, CachedPrice> = {};

        // Convert Map to plain object, excluding expired entries
        const now = Date.now();
        this.priceCache.forEach((value, key) => {
          if (value.expiry > now) {
            data[key] = value;
          }
        });

        localStorage.setItem(this.CACHE_STORAGE_KEY, JSON.stringify(data));
      }
    } catch (error) {
      console.warn('Failed to save price cache to storage:', error);
    }
  }

  private mapMarketStatus(status: string): 'open' | 'closed' | 'extended_hours' {
    switch (status?.toLowerCase()) {
      case 'open':
        return 'open';
      case 'extended_hours':
      case 'extended-hours':
        return 'extended_hours';
      default:
        return 'closed';
    }
  }

  private getCacheKey(symbol: string, date: Date): string {
    return `${symbol.toUpperCase()}:${date.toISOString().split('T')[0]}`;
  }

  private getCachedPrice(symbol: string, date: Date): number | null {
    const key = this.getCacheKey(symbol, date);
    const cached = this.priceCache.get(key);

    if (cached && cached.expiry > Date.now()) {
      return cached.price;
    }

    // Remove expired entry
    if (cached) {
      this.priceCache.delete(key);
    }

    return null;
  }

  private setCachedPrice(symbol: string, date: Date, price: number): void {
    const key = this.getCacheKey(symbol, date);
    const isHistorical = date < new Date(); // Historical if date is in the past
    const ttl = isHistorical ? this.HISTORICAL_CACHE_TTL : this.CURRENT_PRICE_TTL;

    this.priceCache.set(key, {
      price,
      timestamp: Date.now(),
      expiry: Date.now() + ttl,
      isHistorical,
      source: 'api',
    });

    // Debounced save to localStorage to avoid excessive writes
    if (this.saveTimeoutId) {
      clearTimeout(this.saveTimeoutId);
    }

    this.saveTimeoutId = setTimeout(() => {
      this.saveCacheToStorage();
      this.saveTimeoutId = null;
    }, 1000); // Save after 1 second of inactivity
  }

  async getPriceAtDate(symbol: string, date: Date): Promise<number> {
    const dateString = date.toISOString().split('T')[0];
    const todayBusinessDay = getMostRecentBusinessDay();
    const todayBusinessDayString = todayBusinessDay.toISOString().split('T')[0];
    const isToday = dateString === todayBusinessDayString;

    try {
      const db = getUnifiedDatabaseService();

      // For today's price, check current_prices table with staleness check
      if (isToday) {
        const currentPrice = await db.getCurrentPrice(symbol);
        const STALE_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours (daily data is sufficient)

        if (currentPrice) {
          const age = Date.now() - new Date(currentPrice.fetched_at).getTime();
          if (age < STALE_THRESHOLD) {
            console.log(`📊 Using fresh current price for ${symbol}: $${currentPrice.price} (${Math.round(age/1000/60)}min old)`);
            return currentPrice.price;
          }
          console.log(`⏰ Current price for ${symbol} is stale (${Math.round(age/1000/60)}min old), fetching fresh...`);
        }
      } else {
        // For historical dates, check historical_prices table
        const dbPrice = await db.getHistoricalPrice(symbol, dateString);

        if (dbPrice) {
          console.log(`📊 Found ${symbol} price for ${dateString} in database: $${dbPrice.close}`);
          return dbPrice.close;
        }
      }

      // Check in-memory cache
      const cachedPrice = this.getCachedPrice(symbol, date);
      if (cachedPrice !== null) {
        return cachedPrice;
      }

      console.log(`🔍 Fetching ${symbol} price for ${dateString} from API...`);

      // Fetch from API - get a small range around the target date to handle weekends
      const fromDate = new Date(date);
      fromDate.setDate(fromDate.getDate() - 3); // Go back 3 days to handle weekends

      const toDate = new Date(date);
      toDate.setDate(toDate.getDate() + 1); // Include target date

      const prices = await this.getHistoricalPrices(symbol, fromDate, toDate);

      if (prices.length === 0) {
        throw new Error(`No price data found for ${symbol} around ${dateString}`);
      }

      // Find the closest price to our target date
      const targetTime = date.getTime();
      let closestPrice = prices[0];
      let smallestDiff = Math.abs(closestPrice.date.getTime() - targetTime);

      for (const price of prices) {
        const diff = Math.abs(price.date.getTime() - targetTime);
        if (diff < smallestDiff) {
          smallestDiff = diff;
          closestPrice = price;
        }
      }

      // Store prices in database
      // Always store in historical_prices for permanent record
      const priceRecords = prices.map(price => ({
        symbol: symbol.toUpperCase(),
        date: price.date.toISOString().split('T')[0],
        open: price.open,
        high: price.high,
        low: price.low,
        close: price.close,
        volume: price.volume,
        source: 'polygon' as const,
        fetched_at: new Date().toISOString(),
      }));

      await db.insertHistoricalPrices(priceRecords);
      console.log(`✅ Stored ${prices.length} historical price records for ${symbol}`);

      // Also update current_prices for today for fast lookup
      if (isToday) {
        await db.insertCurrentPrice({
          symbol: symbol.toUpperCase(),
          price: closestPrice.close,
          market_status: 'open', // Could enhance to check actual market hours
          source: 'polygon',
          fetched_at: new Date().toISOString(),
        });
        console.log(`✅ Updated current price cache for ${symbol}: $${closestPrice.close}`);
      }

      // Also cache in memory for performance
      for (const price of prices) {
        this.setCachedPrice(symbol, price.date, price.close);
      }

      return closestPrice.close;
    } catch (error) {
      console.warn(`Failed to get price for ${symbol} at ${dateString}:`, error);
      throw error;
    }
  }

  async getBatchPricesAtDates(requests: Array<{ symbol: string; date: Date }>): Promise<PriceAtDate[]> {
    const results: PriceAtDate[] = [];
    const uncachedRequests: Array<{ symbol: string; date: Date; index: number }> = [];

    // Check cache for all requests
    for (let i = 0; i < requests.length; i++) {
      const { symbol, date } = requests[i];
      const cachedPrice = this.getCachedPrice(symbol, date);

      if (cachedPrice !== null) {
        results[i] = { symbol: symbol.toUpperCase(), date, price: cachedPrice };
      } else {
        uncachedRequests.push({ symbol, date, index: i });
      }
    }

    // Group uncached requests by symbol to optimize API calls
    const requestsBySymbol = new Map<string, Array<{ date: Date; index: number }>>();
    for (const req of uncachedRequests) {
      const upperSymbol = req.symbol.toUpperCase();
      if (!requestsBySymbol.has(upperSymbol)) {
        requestsBySymbol.set(upperSymbol, []);
      }
      requestsBySymbol.get(upperSymbol)!.push({ date: req.date, index: req.index });
    }

    // Fetch historical data for each symbol
    for (const [symbol, symbolRequests] of requestsBySymbol) {
      try {
        // Find the date range for this symbol
        const dates = symbolRequests.map(req => req.date);
        const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
        const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));

        // Extend range slightly to handle weekends
        minDate.setDate(minDate.getDate() - 3);
        maxDate.setDate(maxDate.getDate() + 1);

        const historicalPrices = await this.getHistoricalPrices(symbol, minDate, maxDate);

        // Cache all received prices
        for (const price of historicalPrices) {
          this.setCachedPrice(symbol, price.date, price.close);
        }

        // Match requested dates to closest available prices
        for (const { date, index } of symbolRequests) {
          const targetTime = date.getTime();
          let closestPrice = historicalPrices[0];
          let smallestDiff = closestPrice ? Math.abs(closestPrice.date.getTime() - targetTime) : Infinity;

          for (const price of historicalPrices) {
            const diff = Math.abs(price.date.getTime() - targetTime);
            if (diff < smallestDiff) {
              smallestDiff = diff;
              closestPrice = price;
            }
          }

          if (closestPrice) {
            results[index] = {
              symbol,
              date,
              price: closestPrice.close,
            };
          } else {
            // Fallback: use 0 if no price found
            results[index] = {
              symbol,
              date,
              price: 0,
            };
          }
        }
      } catch (error) {
        console.warn(`Failed to get batch prices for ${symbol}:`, error);

        // Set fallback prices for failed requests
        for (const { date, index } of symbolRequests) {
          results[index] = {
            symbol,
            date,
            price: 0,
          };
        }
      }
    }

    // Filter out any undefined results and sort by original request order
    return results.filter(Boolean).sort((a, b) => {
      const aIndex = requests.findIndex(req => req.symbol.toUpperCase() === a.symbol && req.date.getTime() === a.date.getTime());
      const bIndex = requests.findIndex(req => req.symbol.toUpperCase() === b.symbol && req.date.getTime() === b.date.getTime());
      return aIndex - bIndex;
    });
  }

  async getLatestPrices(symbols: string[]): Promise<Record<string, number>> {
    const quotes = await this.getQuotes(symbols);
    const prices: Record<string, number> = {};

    // Store current prices in database for historical reference
    const db = getUnifiedDatabaseService();
    const currentPriceRecords = [];

    for (const quote of quotes) {
      prices[quote.symbol] = quote.price;

      // Store in database if price is valid
      if (quote.price > 0) {
        currentPriceRecords.push({
          symbol: quote.symbol,
          price: quote.price,
          market_status: quote.marketStatus,
          source: 'polygon' as const,
          fetched_at: quote.timestamp.toISOString(),
        });
      }
    }

    // Batch insert current prices
    if (currentPriceRecords.length > 0) {
      try {
        for (const record of currentPriceRecords) {
          await db.insertCurrentPrice(record);
        }
        console.log(`📈 Updated ${currentPriceRecords.length} current prices in database`);
      } catch (error) {
        console.warn('Failed to store current prices in database:', error);
      }
    }

    return prices;
  }

  async getMonthlyPrices(symbol: string, year: number, month: number): Promise<HistoricalPrice[]> {
    // Calculate the date range for the month
    const fromDate = new Date(year, month - 1, 1); // month - 1 because Date uses 0-based months
    const toDate = new Date(year, month, 0); // Last day of the month

    try {
      const prices = await this.getHistoricalPrices(symbol, fromDate, toDate);

      // Cache all prices we received for future use
      for (const price of prices) {
        this.setCachedPrice(symbol, price.date, price.close);
      }

      return prices;
    } catch (error) {
      console.warn(`Failed to get monthly prices for ${symbol} (${year}-${month.toString().padStart(2, '0')}):`, error);
      return [];
    }
  }

  async getBatchMonthlyPrices(requests: Array<{ symbol: string; year: number; month: number }>): Promise<Record<string, HistoricalPrice[]>> {
    const results: Record<string, HistoricalPrice[]> = {};

    // Group requests by symbol to optimize API calls
    const requestsBySymbol = new Map<string, Array<{ year: number; month: number }>>();
    for (const req of requests) {
      const upperSymbol = req.symbol.toUpperCase();
      if (!requestsBySymbol.has(upperSymbol)) {
        requestsBySymbol.set(upperSymbol, []);
      }
      requestsBySymbol.get(upperSymbol)!.push({ year: req.year, month: req.month });
    }

    // Process each symbol
    for (const [symbol, symbolRequests] of requestsBySymbol) {
      try {
        // For each symbol, find the overall date range and make a single API call
        const dates = symbolRequests.map(req => ({
          from: new Date(req.year, req.month - 1, 1),
          to: new Date(req.year, req.month, 0)
        }));

        const minDate = new Date(Math.min(...dates.map(d => d.from.getTime())));
        const maxDate = new Date(Math.max(...dates.map(d => d.to.getTime())));

        // Get all historical data for the symbol in one call
        const allPrices = await this.getHistoricalPrices(symbol, minDate, maxDate);

        // Cache all prices
        for (const price of allPrices) {
          this.setCachedPrice(symbol, price.date, price.close);
        }

        // Split the data by month for each request
        for (const { year, month } of symbolRequests) {
          const monthStart = new Date(year, month - 1, 1);
          const monthEnd = new Date(year, month, 0);

          const monthPrices = allPrices.filter(price =>
            price.date >= monthStart && price.date <= monthEnd
          );

          const key = `${symbol}-${year}-${month.toString().padStart(2, '0')}`;
          results[key] = monthPrices;
        }
      } catch (error) {
        console.warn(`Failed to get batch monthly prices for ${symbol}:`, error);

        // Set empty results for failed requests
        for (const { year, month } of symbolRequests) {
          const key = `${symbol}-${year}-${month.toString().padStart(2, '0')}`;
          results[key] = [];
        }
      }
    }

    return results;
  }
}

// Service factory
let marketDataService: MarketDataService | null = null;

export function getMarketDataService(): MarketDataService {
  if (!marketDataService) {
    const apiKey = process.env.POLYGON_API_KEY;
    const rateLimitPerMinute = parseInt(process.env.POLYGON_RATE_LIMIT_PER_MINUTE || '5');

    if (!apiKey) {
      throw new Error('POLYGON_API_KEY environment variable is required');
    }

    marketDataService = new PolygonMarketDataService(apiKey, rateLimitPerMinute);
  }

  return marketDataService;
}

// For testing - allows injection of a mock service
export function setMarketDataService(service: MarketDataService): void {
  marketDataService = service;
}

export function resetMarketDataService(): void {
  marketDataService = null;
}