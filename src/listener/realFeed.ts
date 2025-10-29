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
import { startPendingOrdersListener, getOpenOrdersAsIntents, stopPendingOrdersListener } from './pendingOrdersListener.js';

// Configuration for Base mainnet RPC endpoints
const BASE_MAINNET_RPC = 'https://mainnet.base.org';
const BASE_MAINNET_WS = 'wss://base-mainnet.publicnode.com'; // Public WebSocket for mempool monitoring

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

