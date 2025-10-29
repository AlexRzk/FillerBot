/**
 * src/listener/realFeed.ts
 * PURPOSE: Fetch real intents from Base mainnet and maintain live order feed.
 */

import { Intent } from '../models/intent';
import logger from '../logger';
import { ethers } from 'ethers';
import { config } from '../config';
import { startPendingOrdersListener, getOpenOrdersAsIntents, stopPendingOrdersListener } from './pendingOrdersListener';

const BASE_MAINNET_RPC = config.RPC_URLS[0];

function getWebSocketUrl(httpRpcUrl: string): string {
  try {
    const url = new URL(httpRpcUrl);
    url.protocol = 'wss:';
    return url.toString();
  } catch {
    logger.warn(`[Feed] Could not convert HTTP RPC to WebSocket: ${httpRpcUrl}`);
    const match = httpRpcUrl.match(/alchemy\.com\/v2\/([a-zA-Z0-9-]+)/);
    if (match && match[1]) {
      return `wss://base-mainnet.g.alchemy.com/v2/${match[1]}`;
    }
    return 'wss://base-mainnet.publicnode.com';
  }
}

const BASE_MAINNET_WS = getWebSocketUrl(BASE_MAINNET_RPC);

export async function fetchRealIntents(): Promise<Intent[]> {
  logger.debug('Fetching real intents...');
  return [];
}

export function startRealFeed(
  intervalMs: number = 5000,
  onIntents: (intents: Intent[]) => void
): () => void {
  logger.info(`Starting real Base mainnet intent feed (updates every ${intervalMs}ms)`);
  logger.info(`[Feed] HTTP RPC: ${BASE_MAINNET_RPC}`);
  logger.info(`[Feed] WebSocket RPC: ${BASE_MAINNET_WS} (for mempool monitoring)`);

  const provider = new ethers.JsonRpcProvider(BASE_MAINNET_RPC);

  let stopPendingListener: (() => void) | null = null;

  startPendingOrdersListener(
    provider,
    BASE_MAINNET_WS,
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

  const interval = setInterval(async () => {
    try {
      const openOrders = getOpenOrdersAsIntents();

      if (openOrders.length > 0) {
        logger.debug(`[Feed] Polling: Found ${openOrders.length} pending orders in store`);
      }
    } catch (error) {
      logger.error(`[Feed] Polling error: ${error}`);
    }
  }, intervalMs);

  return () => {
    clearInterval(interval);
    if (stopPendingListener) {
      stopPendingListener();
      stopPendingOrdersListener();
    }
    logger.info('[Feed] Real intent feed stopped');
  };
}