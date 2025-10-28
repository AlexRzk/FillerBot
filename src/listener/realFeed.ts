/**
 * src/listener/realFeed.ts
 * PURPOSE: Fetch ONLY real intents from Optimism mainnet via public APIs.
 * NO synthetic intent generation - returns empty if no real intents available.
 */

import { Intent } from '../models/intent';
import logger from '../logger';
import { ethers } from 'ethers';
import { fetchUniswapXOrders, canFillUniswapXOrder } from './uniswapXFeed.js';

/**
 * Fetch orders from CoW Protocol API on Optimism using POST-based query.
 * Note: CoW Protocol does NOT support Optimism - disabled to reduce log noise.
 */
async function fetchCowProtocolOrders(): Promise<Intent[]> {
  // CoW Protocol only supports: Ethereum Mainnet, Gnosis Chain, Arbitrum
  // Optimism is NOT supported as of October 2024
  // Skipping query to reduce log noise
  return [];
}

/**
 * Fetch REAL trade data from Optimism mainnet via various APIs.
 * Attempts to get actual pending intents from real networks.
 */
async function fetchRealOptimismSwaps(): Promise<Intent[]> {
  try {
    // Only UniswapX is working on Optimism currently
    // CoW Protocol doesn't support Optimism
    // Uniswap V3 Subgraph has been removed
    
    // UniswapX already queried in main fetchRealIntents
    // This function is a fallback placeholder
    return [];
  } catch (error) {
    logger.debug(`Real swap fetch error: ${error}`);
    return [];
  }
}

/**
 * Main function to fetch ONLY real intents from Optimism mainnet.
 * No synthetic fallback - returns empty array if no real intents found.
 * 
 * Priority order:
 * 1. UniswapX (primary intent protocol for Optimism)
 * 2. CoW Protocol (may not support Optimism)
 * 3. MEV/mempool intents
 */
export async function fetchRealIntents(): Promise<Intent[]> {
  logger.debug('Fetching REAL intents only from Optimism mainnet...');
  
  // Create provider for UniswapX event queries
  const provider = new ethers.JsonRpcProvider('https://mainnet.optimism.io');
  
  // Try UniswapX first (primary intent protocol for Optimism)
  try {
    const uniswapXIntents = await fetchUniswapXOrders(provider);
    if (uniswapXIntents.length > 0) {
      // Filter out orders in exclusive windows we can't fill
      const fillable = uniswapXIntents.filter(canFillUniswapXOrder);
      if (fillable.length > 0) {
        logger.info(`Found ${fillable.length} fillable UniswapX orders (${uniswapXIntents.length - fillable.length} excluded)`);
        return fillable;
      }
    }
  } catch (error: any) {
    logger.error(`UniswapX fetch error: ${error.message}`);
  }

  // Try real swaps from mempool/intent pools
  const realSwaps = await fetchRealOptimismSwaps();
  if (realSwaps.length > 0) return realSwaps;

  // Try CoW Protocol API (may not support Optimism)
  const cowIntents = await fetchCowProtocolOrders();
  if (cowIntents.length > 0) return cowIntents;

  // No real intents found - return empty (no synthetic fallback)
  logger.debug('No real intents found from any source');
  return [];
}

/**
 * Start a continuous feed that updates intents periodically.
 */
export function startRealFeed(
  intervalMs: number = 5000,
  onIntents: (intents: Intent[]) => void
): () => void {
  logger.info(`Starting real OP mainnet intent feed (updates every ${intervalMs}ms)`);

  const interval = setInterval(async () => {
    try {
      const intents = await fetchRealIntents();
      if (intents.length > 0) {
        onIntents(intents);
      }
    } catch (error) {
      logger.error(`Real feed error: ${error}`);
    }
  }, intervalMs);

  return () => {
    clearInterval(interval);
    logger.info('Real intent feed stopped');
  };
}

