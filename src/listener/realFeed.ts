/**
 * src/listener/realFeed.ts
 * PURPOSE: Fetch real intents from Base mainnet.
 * NOTE: Primary source is now pendingOrdersListener.ts which monitors 
 * OrderPlaced events in real-time and maintains an open orders store.
 */

import { Intent } from '../models/intent';
import logger from '../logger';
import { ethers } from 'ethers';
import { startPendingOrdersListener, getOpenOrdersAsIntents } from './pendingOrdersListener.js';

/**
 * Main function to fetch ONLY real intents from Base mainnet.
 * NOTE: Pending orders are now fetched in real-time via pendingOrdersListener
 * which is more efficient than polling here.
 */
export async function fetchRealIntents(): Promise<Intent[]> {
  // Pending orders are now handled by the dedicated pendingOrdersListener
  // which maintains an open orders store in real-time.
  // This function is kept for backward compatibility but returns empty.
  logger.debug('Fetching real intents...');
  return [];
}

/**
 * Start a continuous feed that updates intents periodically.
 * Now includes real-time pending orders listener.
 */
export function startRealFeed(
  intervalMs: number = 5000,
  onIntents: (intents: Intent[]) => void
): () => void {
  logger.info(`Starting real Base mainnet intent feed (updates every ${intervalMs}ms)`);

  // Create provider for pending orders listener
  const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');

  // Start pending orders listener (this will maintain open orders in real-time)
  let stopPendingListener: (() => void) | null = null;

  startPendingOrdersListener(provider, (newOrders: Intent[]) => {
    if (newOrders.length > 0) {
      logger.info(`Real-time: Received ${newOrders.length} new pending orders from listener`);
      onIntents(newOrders);
    }
  })
    .then((stop) => {
      stopPendingListener = stop;
    })
    .catch((error: any) => {
      logger.error(`Failed to start pending orders listener: ${error.message}`);
    });

  const interval = setInterval(async () => {
    try {
      // Get open orders from the pending orders listener store
      const openOrders = getOpenOrdersAsIntents();

      if (openOrders.length > 0) {
        logger.debug(`Polling: Found ${openOrders.length} pending orders in store`);
        onIntents(openOrders);
      }

      // Also try historical intents as fallback
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
    if (stopPendingListener) {
      stopPendingListener();
    }
    logger.info('Real intent feed stopped');
  };
}

