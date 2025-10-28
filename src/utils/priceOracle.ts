/**
 * Chainlink Price Oracle Integration
 * 
 * Fetches real-time token prices from Chainlink oracles on Optimism.
 * Includes staleness checks and circuit breaker logic.
 */

import { ethers } from 'ethers';
import { SAFETY_CONFIG, getChainlinkFeed } from '../config/safety.js';

// Chainlink Aggregator ABI (minimal interface)
const CHAINLINK_AGGREGATOR_ABI = [
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() external view returns (uint8)',
];

interface PriceData {
  price: number;
  decimals: number;
  updatedAt: number;
  isStale: boolean;
}

/**
 * Price oracle cache to reduce RPC calls
 */
const priceCache = new Map<string, { data: PriceData; fetchedAt: number }>();
const CACHE_TTL_MS = 60000; // 1 minute cache

/**
 * Fetch token price from Chainlink oracle
 * 
 * @param tokenAddress Token contract address
 * @param provider ethers provider connected to Optimism
 * @returns Price in USD with metadata
 */
export async function getTokenPriceUSD(
  tokenAddress: string,
  provider: ethers.Provider
): Promise<number> {
  try {
    // Check cache first
    const cached = priceCache.get(tokenAddress.toLowerCase());
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      if (cached.data.isStale) {
        throw new Error(`Price data for ${tokenAddress} is stale (${Math.floor((Date.now() / 1000) - cached.data.updatedAt)}s old)`);
      }
      return cached.data.price;
    }

    // Get Chainlink feed address for this token
    const feedAddress = getChainlinkFeed(tokenAddress);
    if (!feedAddress) {
      throw new Error(`No Chainlink feed found for token ${tokenAddress}`);
    }

    // Create contract instance
    const aggregator = new ethers.Contract(
      feedAddress,
      CHAINLINK_AGGREGATOR_ABI,
      provider
    );

    // Fetch latest price data
    const [, answer, , updatedAt] = await aggregator.latestRoundData();
    const decimals = await aggregator.decimals();

    // Convert price to USD (Chainlink prices have 8 decimals)
    const price = Number(answer) / Math.pow(10, Number(decimals));

    // Check staleness
    const now = Math.floor(Date.now() / 1000);
    const age = now - Number(updatedAt);
    const isStale = age > SAFETY_CONFIG.PRICE_STALENESS_SECONDS;

    const priceData: PriceData = {
      price,
      decimals: Number(decimals),
      updatedAt: Number(updatedAt),
      isStale,
    };

    // Cache the result
    priceCache.set(tokenAddress.toLowerCase(), {
      data: priceData,
      fetchedAt: Date.now(),
    });

    if (isStale) {
      throw new Error(`Price data is stale: ${age}s old (max ${SAFETY_CONFIG.PRICE_STALENESS_SECONDS}s)`);
    }

    // Sanity check: price should be reasonable
    if (price <= 0 || price > 1000000) {
      throw new Error(`Unreasonable price returned: $${price}`);
    }

    console.log(`[oracle] ${tokenAddress.slice(0, 10)}... = $${price.toFixed(2)} (${age}s old)`);
    return price;

  } catch (error: any) {
    // Only log debug messages for stale prices (reduces noise)
    if (error.message?.includes('stale')) {
      console.debug(`[oracle] ${tokenAddress.slice(0, 10)}... stale (${error.message})`);
    } else {
      console.error(`[error] Failed to fetch price for ${tokenAddress}:`, error.message);
    }
    throw error;
  }
}

/**
 * Convert token amount to USD using Chainlink oracle
 * 
 * @param amount Token amount in wei (bigint)
 * @param tokenAddress Token contract address
 * @param tokenDecimals Token decimals (18 for WETH, 6 for USDC, etc.)
 * @param provider ethers provider
 * @returns USD value
 */
export async function convertToUSD(
  amount: bigint,
  tokenAddress: string,
  tokenDecimals: number,
  provider: ethers.Provider
): Promise<number> {
  try {
    // Get price from Chainlink
    const priceUSD = await getTokenPriceUSD(tokenAddress, provider);
    
    // Convert amount to token units
    const tokenAmount = Number(amount) / Math.pow(10, tokenDecimals);
    
    // Calculate USD value
    const usdValue = tokenAmount * priceUSD;
    
    return usdValue;
  } catch (error: any) {
    console.error(`[error] Failed to convert ${amount} to USD:`, error.message);
    throw error;
  }
}

/**
 * Get multiple token prices in parallel
 * 
 * @param tokenAddresses Array of token addresses
 * @param provider ethers provider
 * @returns Map of token address to price
 */
export async function getMultipleTokenPrices(
  tokenAddresses: string[],
  provider: ethers.Provider
): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  
  // Fetch all prices in parallel
  const results = await Promise.allSettled(
    tokenAddresses.map(addr => getTokenPriceUSD(addr, provider))
  );
  
  // Collect successful results (suppress per-token error logs)
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      prices.set(tokenAddresses[index].toLowerCase(), result.value);
    }
    // Errors are already logged by getTokenPriceUSD - don't duplicate
  });
  
  return prices;
}

/**
 * Validate price against previous value (detect manipulation)
 * 
 * @param currentPrice Current price
 * @param previousPrice Previous cached price
 * @returns true if price is valid
 */
export function validatePriceChange(currentPrice: number, previousPrice: number): boolean {
  if (!previousPrice) return true; // No previous price to compare
  
  const changePercent = Math.abs((currentPrice - previousPrice) / previousPrice) * 100;
  
  if (changePercent > SAFETY_CONFIG.MAX_PRICE_DEVIATION_PERCENT) {
    console.warn(`[warn] Price deviation too large: ${changePercent.toFixed(2)}% (max ${SAFETY_CONFIG.MAX_PRICE_DEVIATION_PERCENT}%)`);
    return false;
  }
  
  return true;
}

/**
 * Clear price cache (useful for testing or after circuit breaker)
 */
export function clearPriceCache(): void {
  priceCache.clear();
  console.log('[oracle] Price cache cleared');
}

/**
 * Get token decimals for common tokens
 */
export function getTokenDecimals(tokenAddress: string): number {
  const addr = tokenAddress.toLowerCase();
  
  // USDC, USDT have 6 decimals
  if (addr === '0x0b2c639c533813f4aa9d7837caf62653d097ff85' || // USDC
      addr === '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58') { // USDT
    return 6;
  }
  
  // WBTC has 8 decimals
  if (addr === '0x68f180fcce6836688e9084f035309e29bf0a2095') { // WBTC
    return 8;
  }
  
  // Most tokens (WETH, DAI, OP) have 18 decimals
  return 18;
}
