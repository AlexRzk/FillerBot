/**
 * src/listener/mempoolOrderListener.ts
 * PURPOSE: Listen for pending transactions to the UniswapX Priority Reactor (mempool monitoring)
 * 
 * This is the CORRECT approach to discover pending orders on Base:
 * 1. Monitor the mempool via WebSocket for transactions
 * 2. Filter for transactions sent to the PriorityOrderReactor
 * 3. Decode the transaction calldata to extract order details
 * 4. Track pending orders before they're filled
 * 
 * Key advantages:
 * - Detects orders BEFORE they're filled (unlike listening to Fill events)
 * - Uses actual transaction data (reliable)
 * - No reliance on non-existent events (OrderPlaced doesn't exist on Base)
 * 
 * Limitations:
 * - Requires WebSocket RPC (HTTP polling won't work for mempool)
 * - Some transactions may be filtered by public nodes
 * - Need proper transaction decoding with UniswapX SDK
 */

import { ethers } from 'ethers';
import { Intent } from '../models/intent.js';
import { DecodedPriorityOrder, decodePriorityOrderCalldata } from '../utils/uniswapxDecoder.js';

const UNISWAPX_PRIORITY_REACTOR_BASE = '0x000000001Ec5656dcdB24D90DFa42742738De729';

/**
 * Represents a pending transaction-based order.
 */
interface PendingTxOrder {
  txHash: string;
  blockNumber: number | null;
  timestamp: number;
  decodedOrder: DecodedPriorityOrder;
  retryCount: number;
}

/**
 * Mempool listener state.
 */
interface MempoolListenerState {
  isRunning: boolean;
  pendingOrders: Map<string, PendingTxOrder>; // Map of txHash => PendingTxOrder
  wsProvider: ethers.WebSocketProvider | null;
  unsubscribe?: () => void;
}

const state: MempoolListenerState = {
  isRunning: false,
  pendingOrders: new Map(),
  wsProvider: null,
};

/**
 * Start listening to mempool transactions for pending UniswapX orders.
 * 
 * This function:
 * 1. Establishes a WebSocket connection for mempool monitoring
 * 2. Subscribes to "pending" transactions
 * 3. Filters for transactions to the PriorityOrderReactor
 * 4. Decodes order details from transaction calldata
 * 5. Tracks pending orders until they're filled or timeout
 * 
 * @param wsRpcUrl WebSocket RPC URL (e.g., wss://base-mainnet.publicnode.com)
 * @param onNewOrder Callback when a new pending order is detected
 * @returns Stop function to halt the listener
 */
export async function startMempoolOrderListener(
  wsRpcUrl: string,
  onNewOrder: (orders: Intent[]) => void
): Promise<() => void> {
  if (state.isRunning) {
    console.log('[warn] Mempool order listener already running');
    return () => {};
  }

  state.isRunning = true;
  console.log('[info] Starting mempool order listener...');

  try {
    // Establish WebSocket connection
    console.log(`[info] Connecting to WebSocket RPC: ${wsRpcUrl}`);
    state.wsProvider = new ethers.WebSocketProvider(wsRpcUrl);

    // Test connection
    const network = await state.wsProvider.getNetwork();
    console.log(`[info] ✅ Connected to chain: ${network.chainId} (${network.name})`);

    // Subscribe to pending transactions
    console.log('[info] Subscribing to pending transactions...');
    const unsubscribePending = subscribeToPendingTransactions(onNewOrder);

    // Setup periodic cleanup of stale orders
    const cleanupInterval = setInterval(() => {
      cleanupStalePendingOrders();
    }, 60000); // Every minute

    // Return stop function
    state.unsubscribe = () => {
      console.log('[info] Stopping mempool order listener...');
      unsubscribePending();
      clearInterval(cleanupInterval);
      
      if (state.wsProvider) {
        state.wsProvider.destroy();
        state.wsProvider = null;
      }
      
      state.isRunning = false;
      state.pendingOrders.clear();
      console.log('[info] Mempool order listener stopped');
    };

    return state.unsubscribe;
  } catch (error: any) {
    console.error('[error] Failed to start mempool order listener:', error.message);
    state.isRunning = false;
    return () => {};
  }
}

/**
 * Stop the mempool order listener.
 */
export function stopMempoolOrderListener(): void {
  if (state.unsubscribe) {
    state.unsubscribe();
  }
}

/**
 * Subscribe to pending transactions and filter for reactor interactions.
 */
function subscribeToPendingTransactions(onNewOrder: (orders: Intent[]) => void): () => void {
  if (!state.wsProvider) {
    throw new Error('WebSocket provider not initialized');
  }

  let isSubscribed = true;

  // Set up pending transaction listener
  const onPending = async (txHash: string) => {
    if (!isSubscribed || !state.wsProvider) {
      return;
    }

    try {
      // Fetch full transaction details
      const tx = await state.wsProvider.getTransaction(txHash);

      if (!tx) {
        // Transaction not found (normal - some txs not fully propagated)
        return;
      }

      // Check if transaction is to the PriorityOrderReactor
      if (tx.to?.toLowerCase() !== UNISWAPX_PRIORITY_REACTOR_BASE.toLowerCase()) {
        // Not a reactor transaction, skip
        return;
      }

      // Log that we found a reactor transaction
      console.log(`[info] 🔍 Found transaction to reactor: ${txHash.slice(0, 10)}...`);

      // Try to decode the order
      const decodedOrder = decodePriorityOrderCalldata(tx.data, tx.value || BigInt(0));

      if (!decodedOrder) {
        console.log('[warn] Could not decode order from transaction data');
        return;
      }

      // Add to pending orders
      const pendingOrder: PendingTxOrder = {
        txHash,
        blockNumber: tx.blockNumber,
        timestamp: Date.now(),
        decodedOrder,
        retryCount: 0,
      };

      // Check if we already have this order
      if (state.pendingOrders.has(txHash)) {
        console.log('[debug] Order already in pending list, skipping');
        return;
      }

      state.pendingOrders.set(txHash, pendingOrder);
      console.log(
        `[info] ✅ New pending order detected: ${txHash.slice(0, 10)}... from ${tx.from.slice(0, 10)}...`
      );
      console.log(`[info] Total pending orders: ${state.pendingOrders.size}`);

      // Convert to Intent for matcher
      const intent = txOrderToIntent(txHash, tx, decodedOrder);

      // Invoke callback
      onNewOrder([intent]);
    } catch (error: any) {
      console.debug('[debug] Error processing pending transaction:', error.message);
    }
  };

  // Subscribe to pending events
  state.wsProvider.on('pending', onPending);

  // Return unsubscribe function
  return () => {
    isSubscribed = false;
    if (state.wsProvider) {
      state.wsProvider.off('pending', onPending);
      console.log('[info] Unsubscribed from pending transactions');
    }
  };
}

/**
 * Remove pending orders that are too old or have been pending too long.
 * 
 * Orders can become stale if:
 * - The transaction was replaced/dropped by the mempool
 * - The transaction has been pending for too long
 */
function cleanupStalePendingOrders(): void {
  const now = Date.now();
  const MAX_PENDING_AGE = 15 * 60 * 1000; // 15 minutes

  let removedCount = 0;

  for (const [txHash, order] of state.pendingOrders.entries()) {
    const age = now - order.timestamp;

    if (age > MAX_PENDING_AGE) {
      console.log(
        `[info] 🗑️ Removing stale order: ${txHash.slice(0, 10)}... (age: ${Math.round(age / 1000)}s)`
      );
      state.pendingOrders.delete(txHash);
      removedCount++;
    }
  }

  if (removedCount > 0) {
    console.log(
      `[info] Cleanup: Removed ${removedCount} stale orders. Remaining: ${state.pendingOrders.size}`
    );
  }
}

/**
 * Convert transaction + decoded order to Intent for the matcher.
 */
function txOrderToIntent(
  txHash: string,
  tx: ethers.TransactionResponse,
  decodedOrder: DecodedPriorityOrder
): Intent {
  return {
    id: `uniswapx:${txHash}`,
    maker: tx.from, // The transaction signer/order creator
    sellToken: decodedOrder.inputToken,
    buyToken: decodedOrder.outputToken,
    sellAmount: decodedOrder.inputAmount,
    minBuyAmount: decodedOrder.outputAmount,
    deadline: Number(decodedOrder.deadline),
    status: 'pending',
    createdAt: Math.floor(Date.now() / 1000),
  };
}

/**
 * Get current pending orders from mempool.
 */
export function getPendingMempoolOrders(): PendingTxOrder[] {
  return Array.from(state.pendingOrders.values());
}

/**
 * Get count of pending orders.
 */
export function getPendingMempoolOrdersCount(): number {
  return state.pendingOrders.size;
}

/**
 * Get pending orders as Intent array for matcher.
 */
export function getPendingMempoolOrdersAsIntents(): Intent[] {
  return Array.from(state.pendingOrders.values()).map((order) => ({
    id: `uniswapx:${order.txHash}`,
    maker: order.decodedOrder.swapper,
    sellToken: order.decodedOrder.inputToken,
    buyToken: order.decodedOrder.outputToken,
    sellAmount: order.decodedOrder.inputAmount,
    minBuyAmount: order.decodedOrder.outputAmount,
    deadline: Number(order.decodedOrder.deadline),
    status: 'pending',
    createdAt: Math.floor(order.timestamp / 1000),
  }));
}

/**
 * Manually remove an order from pending list (e.g., after it's filled).
 */
export function removePendingMempoolOrder(txHash: string): void {
  if (state.pendingOrders.has(txHash)) {
    state.pendingOrders.delete(txHash);
    console.log(`[info] Removed order from pending list: ${txHash.slice(0, 10)}...`);
    console.log(`[info] Total pending orders: ${state.pendingOrders.size}`);
  }
}

/**
 * Check if we have a WebSocket connection.
 */
export function hasMempoolConnection(): boolean {
  return state.wsProvider !== null && state.isRunning;
}
