/**
 * src/listener/pendingOrdersListener.ts
 * PURPOSE: Main entry point for listening to PENDING/UNFILLED orders from UniswapX Priority Reactor.
 * 
 * ⚠️ CRITICAL FIX APPLIED: Listening for the CORRECT event sources!
 * 
 * Previous Bug (FIXED):
 * - Code was listening for non-existent OrderPlaced(bytes32,address) event
 * - Result: 0 historical events, 0 new orders detected
 * 
 * Solution (IMPLEMENTED):
 * - Use mempoolOrderListener.ts to monitor ACTUAL transactions to the reactor
 * - Decode transaction calldata to extract order details
 * - Keep Fill event listening as a cleanup mechanism
 * 
 * UniswapX Priority Order Reactor on Base:
 * - Contract: 0x000000001Ec5656dcdB24D90DFa42742738De729
 * - Events that ACTUALLY exist:
 *   - Fill(bytes32 indexed orderHash, address indexed filler, address indexed swapper, uint256 nonce)
 *   - OwnershipTransferred(address indexed user, address indexed newOwner)
 *   - ProtocolFeeControllerSet(address oldFeeController, address newFeeController)
 * - Event that DOES NOT exist: OrderPlaced ❌
 * 
 * Architecture:
 * 1. Mempool listener: Detects new pending orders before execution
 * 2. Fill event listener: Tracks order completion and cleans up pending list
 * 3. Provides consolidated view of pending orders for matching
 */

import { ethers } from 'ethers';
import { Intent } from '../models/intent.js';
import {
  startMempoolOrderListener,
  stopMempoolOrderListener,
  getPendingMempoolOrdersAsIntents,
  removePendingMempoolOrder,
} from './mempoolOrderListener.js';

const UNISWAPX_PRIORITY_REACTOR_BASE = '0x000000001Ec5656dcdB24D90DFa42742738De729';

/**
 * Pending orders listener state.
 */
interface ListenerState {
  isRunning: boolean;
  mempoolUnsubscribe?: () => void;
  fillEventUnsubscribe?: () => void;
  lastSeenBlock: number;
}

const state: ListenerState = {
  isRunning: false,
  lastSeenBlock: 0,
};

/**
 * Start listening to pending orders from UniswapX Priority Reactor.
 * 
 * This function:
 * 1. Starts mempool monitoring (monitors pending transactions to reactor)
 * 2. Subscribes to Fill events to track order completion and cleanup
 * 3. Maintains consolidated view of pending orders
 * 
 * IMPORTANT: Requires a WebSocket RPC URL for mempool monitoring!
 * HTTP RPC won't work for listening to pending transactions.
 * 
 * @param provider HTTP provider connected to Base mainnet
 * @param wsRpcUrl WebSocket RPC URL for mempool monitoring (e.g., wss://base-mainnet.publicnode.com)
 * @param onNewOrder Callback when a new pending order is detected
 * @returns Stop function to halt the listener
 */
export async function startPendingOrdersListener(
  provider: ethers.Provider,
  wsRpcUrl: string,
  onNewOrder: (orders: Intent[]) => void
): Promise<() => void> {
  if (state.isRunning) {
    console.log('[warn] Pending orders listener already running');
    return () => {};
  }

  state.isRunning = true;
  console.log('[info] Starting pending orders listener...');

  try {
    // Get current block number
    const currentBlock = await provider.getBlockNumber();
    state.lastSeenBlock = currentBlock;
    console.log(`[info] Current block: ${currentBlock}`);

    // Step 1: Start mempool monitoring (detects new pending orders BEFORE execution)
    console.log('[info] Starting mempool order listener...');
    state.mempoolUnsubscribe = await startMempoolOrderListener(wsRpcUrl, onNewOrder);
    console.log('[info] ✅ Mempool listener started successfully');

    // Step 2: Subscribe to Fill events for cleanup tracking
    console.log('[info] Subscribing to Fill events for order completion tracking...');
    state.fillEventUnsubscribe = subscribeToFillEvents(provider);
    console.log('[info] ✅ Fill event listener started');

    // Return stop function
    const unsubscribe = () => {
      console.log('[info] Stopping pending orders listener...');

      if (state.mempoolUnsubscribe) {
        stopMempoolOrderListener();
        state.mempoolUnsubscribe = undefined;
      }

      if (state.fillEventUnsubscribe) {
        state.fillEventUnsubscribe();
        state.fillEventUnsubscribe = undefined;
      }

      state.isRunning = false;
      console.log('[info] Pending orders listener stopped');
    };

    return unsubscribe;
  } catch (error: any) {
    console.error('[error] Failed to start pending orders listener:', error.message);
    console.error('[error] Make sure you provided a valid WebSocket RPC URL');
    state.isRunning = false;
    return () => {};
  }
}

/**
 * Stop the pending orders listener.
 */
export function stopPendingOrdersListener(): void {
  if (state.mempoolUnsubscribe) {
    state.mempoolUnsubscribe();
    state.mempoolUnsubscribe = undefined;
  }
  if (state.fillEventUnsubscribe) {
    state.fillEventUnsubscribe();
    state.fillEventUnsubscribe = undefined;
  }
  state.isRunning = false;
}

/**
 * Subscribe to Fill events to track when orders are completed on-chain.
 * 
 * When an order is filled:
 * 1. We log the fill event
 * 2. We remove it from pending mempool list
 * 3. This helps us track successful fills
 * 
 * @param provider Ethers provider connected to Base
 * @returns Unsubscribe function
 */
function subscribeToFillEvents(provider: ethers.Provider): () => void {
  const fillTopic = ethers.id('Fill(bytes32,address,address,uint256)');

  let isSubscribed = true;
  let lastCheckedBlock = state.lastSeenBlock;

  const pollInterval = setInterval(async () => {
    if (!isSubscribed) {
      clearInterval(pollInterval);
      return;
    }

    try {
      const currentBlock = await provider.getBlockNumber();

      if (currentBlock > lastCheckedBlock) {
        // Suppress warnings during polling
        const originalError = console.error;
        console.error = (...args: any[]) => {
          const message = args[0]?.toString() || '';
          if (!message.includes('Failed to decode') && !message.includes('BUFFER_OVERRUN')) {
            originalError.apply(console, args);
          }
        };

        const logs = await provider.getLogs({
          address: UNISWAPX_PRIORITY_REACTOR_BASE,
          topics: [fillTopic],
          fromBlock: lastCheckedBlock + 1,
          toBlock: currentBlock,
        });

        console.error = originalError;

        logs.forEach((log) => {
          try {
            const orderHash = log.topics[1];

            // Remove from pending mempool orders if present
            removePendingMempoolOrder(orderHash);

            console.log(
              `[info] ✅ Order filled on-chain: ${orderHash.slice(0, 10)}...`
            );
          } catch (e) {
            // Skip malformed logs
          }
        });

        lastCheckedBlock = currentBlock;
      }
    } catch (error: any) {
      console.warn('[warn] Error polling Fill events:', error.message);
    }
  }, 5000); // Poll every 5 seconds

  return () => {
    isSubscribed = false;
    clearInterval(pollInterval);
    console.log('[info] Fill event subscription stopped');
  };
}

/**
 * Get pending orders as Intent array for the matcher.
 * 
 * These are orders detected from mempool that are still pending.
 * 
 * @returns Array of pending orders as Intent objects
 */
export function getOpenOrdersAsIntents(): Intent[] {
  return getPendingMempoolOrdersAsIntents();
}

/**
 * Get count of pending orders currently being tracked.
 */
export function getOpenOrdersCount(): number {
  return getPendingMempoolOrdersAsIntents().length;
}
