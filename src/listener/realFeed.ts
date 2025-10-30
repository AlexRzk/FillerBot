/**
 * src/listener/realFeed.ts
 * PURPOSE: Fetch real intents from Base mainnet and maintain live order feed.
 */

import { Intent } from '../models/intent';
import logger from '../logger';
import { config } from '../config';
import { getOpenOrdersAsIntents } from './pendingOrdersListener';
import { convertCowOrderToIntent } from '../utils/cow';

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

export async function startCowListener(
  callback: (intent: Intent) => void
): Promise<() => void> {
  const url = 'https://api.cow.fi/mainnet/api/v1/orders';
  
  const fetchOrders = async () => {
    try {
      const response = await fetch(url);
      const data = await response.json();
      const orders = (data as any).orders;
      
      for (const order of orders) {
        const intent = convertCowOrderToIntent(order);
        callback(intent);
      }
    } catch (error) {
      logger.error(`[Feed] Error fetching CoW orders: ${error}`);
    }
  };

  // Poll every 5 seconds
  const intervalId = setInterval(fetchOrders, 5000);
  
  return () => clearInterval(intervalId);
}

export function startRealFeed(
  intervalMs: number = 5000,
  onIntents: (intents: Intent[]) => void
): () => void {
  logger.info(`Starting real Base mainnet intent feed (updates every ${intervalMs}ms)`);
  logger.info(`[Feed] HTTP RPC: ${BASE_MAINNET_RPC}`);
  logger.info(`[Feed] WebSocket RPC: ${BASE_MAINNET_WS} (for mempool monitoring)`);

  let stopCowListener: (() => void) | null = null;

  startCowListener((intent: Intent) => {
    onIntents([intent]);
  })
    .then((stop) => {
      stopCowListener = stop;
      logger.info('[Feed] ✅ CoW Protocol listener started successfully');
    })
    .catch((error: any) => {
      logger.error(`[Feed] ❌ Failed to start CoW Protocol listener: ${error.message}`);
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
    if (stopCowListener) {
      stopCowListener();
    }
    logger.info('[Feed] Real intent feed stopped');
  };
}