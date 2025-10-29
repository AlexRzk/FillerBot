/**
 * src/listener/realFeed.ts
 * PURPOSE: Fetch real intents from Base mainnet and maintain live order feed.
 * 
 * FIX APPLIED: Now uses mempool monitoring via WebSocket for accurate order detection
 * (instead of listening to non-existent OrderPlaced events).
 * 
 * NOTE: Pending orders are fetched via pendingOrdersListener.ts which:
 * - Monitors actual pending transactions to the reactor (mempool)
 * - Decodes transaction calldata to extract order details
 * - Maintains a real-time view of pending unfilled orders
 */

import { Intent } from '../models/intent';
import logger from '../logger';
import { ethers } from 'ethers';
import { config } from '../config';
import { startPendingOrdersListener, getOpenOrdersAsIntents, stopPendingOrdersListener } from './pendingOrdersListener';

// Configuration for Base mainnet RPC endpoints
// Use HTTP for regular calls, WebSocket for mempool monitoring
const BASE_MAINNET_RPC = config.rpcUrl;

// Convert HTTP RPC to WebSocket URL
// Example: https://base-mainnet.g.alchemy.com/v2/KEY -> wss://base-mainnet.g.alchemy.com/v2/KEY
function getWebSocketUrl(httpRpcUrl: string): string {
  try {
    const url = new URL(httpRpcUrl);
    // Replace https with wss
    url.protocol = 'wss:';
    return url.toString();
  } catch {
    // Fallback to a known WebSocket endpoint if conversion fails
    logger.warn(`[Feed] Could not convert HTTP RPC to WebSocket: ${httpRpcUrl}`);
    // Use Alchemy's direct WebSocket if possible (extract the key from HTTP URL)
    const match = httpRpcUrl.match(/alchemy\.com\/v2\/([a-zA-Z0-9-]+)/);
    if (match && match[1]) {
      return `wss://base-mainnet.g.alchemy.com/v2/${match[1]}`;
    }
    // Final fallback to public endpoint
    return 'wss://base-mainnet.publicnode.com';
  }
}

const BASE_MAINNET_WS = getWebSocketUrl(BASE_MAINNET_RPC);

/**
 * Main function to fetch real intents from Base mainnet.
 * NOTE: Pending orders are now fetched in real-time via pendingOrdersListener
 * which monitors actual transactions via mempool.
 */
export async function fetchRealIntents(): Promise<Intent[]> {
  // Pending orders are now handled by the dedicated pendingOrdersListener
  // which maintains an open orders store via mempool monitoring.
  // This function is kept for backward compatibility but returns empty.
  logger.debug('Fetching real intents...');
  return [];
}

/**
 * Start a continuous feed that updates intents periodically.
 * Now includes real-time pending orders listener with proper mempool monitoring.
 * 
 * IMPORTANT: The listener requires a WebSocket RPC connection to monitor the mempool!
 * This URL is provided to the pending orders listener for transaction monitoring.
 */
export function startRealFeed(
  intervalMs: number = 5000,
  onIntents: (intents: Intent[]) => void
): () => void {
  logger.info(`Starting real Base mainnet intent feed (updates every ${intervalMs}ms)`);
  logger.info(`[Feed] HTTP RPC: ${BASE_MAINNET_RPC}`);
  logger.info(`[Feed] WebSocket RPC: ${BASE_MAINNET_WS} (for mempool monitoring)`);

  // Create HTTP provider for general RPC calls
  const provider = new ethers.JsonRpcProvider(BASE_MAINNET_RPC);

  // Start pending orders listener with WebSocket RPC for mempool monitoring
  let stopPendingListener: (() => void) | null = null;

  startPendingOrdersListener(
    provider,
    BASE_MAINNET_WS, // WebSocket URL for mempool monitoring
    (newOrders: Intent[]) => {
      if (newOrders.length > 0) {
        logger.info(`[Feed] Real-time: Received ${newOrders.length} new pending orders from mempool`);
        onIntents(newOrders);
      }
    }
  )
    .then((stop) => {
      stopPendingListener = stop;
      logger.info('[Feed] ✅ Mempool listener started successfully');
    })
    .catch((error: any) => {
      logger.error(`[Feed] ❌ Failed to start pending orders listener: ${error.message}`);
      logger.error('[Feed] Make sure WebSocket RPC is accessible: ' + BASE_MAINNET_WS);
    });

  // Polling interval to check for accumulated orders
  const interval = setInterval(async () => {
    try {
      // Get open orders from the pending orders listener store
      const openOrders = getOpenOrdersAsIntents();

      if (openOrders.length > 0) {
        logger.debug(`[Feed] Polling: Found ${openOrders.length} pending orders in store`);
        // Note: We don't call onIntents here since we already called it in the mempool callback
        // This polling is just for status checking
      }
    } catch (error) {
      logger.error(`[Feed] Polling error: ${error}`);
    }
  }, intervalMs);

  // Return stop function
  return () => {
    clearInterval(interval);
    if (stopPendingListener) {
      stopPendingListener();
      stopPendingOrdersListener();
    }
    logger.info('[Feed] Real intent feed stopped');
  };
}

