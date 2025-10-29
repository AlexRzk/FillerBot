/**
 * src/listener/pendingOrdersListener.ts
 * PURPOSE: Listen to PENDING/UNFILLED orders from UniswapX Priority Reactor on Base mainnet.
 * 
 * Key features:
 * - Maintains an in-memory store of open orders
 * - Listens to OrderPlaced events to detect new pending orders
 * - Listens to Fill events to remove completed orders from the store
 * - Returns real-time pending orders that can be filled
 * 
 * UniswapX Priority Order Reactor on Base:
 * - Contract: 0x000000001Ec5656dcdB24D90DFa42742738De729
 * - Events: OrderPlaced, OrderFilled, OwnershipTransferred
 * 
 * Note: The Priority Order Reactor uses different events than V2 Dutch Auction reactor.
 */

import { ethers } from 'ethers';
import { Intent } from '../models/intent.js';

const UNISWAPX_PRIORITY_REACTOR_BASE = '0x000000001Ec5656dcdB24D90DFa42742738De729';

/**
 * Represents an open order in the store.
 */
interface OpenOrder {
  orderHash: string;
  swapper: string;
  nonce: string;
  deadline: number;
  blockNumber: number;
  timestamp: number;
  rawLog: any; // Store raw log data for reference
}

/**
 * Pending orders listener state.
 */
interface ListenerState {
  isRunning: boolean;
  openOrders: Map<string, OpenOrder>; // Map of orderHash => OpenOrder
  lastSeenBlock: number;
  eventFilter: any;
  unsubscribe?: () => void;
}

const state: ListenerState = {
  isRunning: false,
  openOrders: new Map(),
  lastSeenBlock: 0,
  eventFilter: null,
};

/**
 * Start listening to pending orders from UniswapX Priority Reactor.
 * 
 * This function:
 * 1. Fetches recent OrderPlaced events (last N blocks)
 * 2. Subscribes to new OrderPlaced events in real-time
 * 3. Subscribes to Fill events to remove completed orders
 * 4. Maintains an in-memory store of open orders
 * 
 * @param provider ethers provider connected to Base mainnet
 * @param onNewOrder Callback when a new pending order is detected
 * @returns Stop function to halt the listener
 */
export async function startPendingOrdersListener(
  provider: ethers.Provider,
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

    // Step 1: Fetch historical OrderPlaced events (last 1000 blocks ≈ 33 minutes on Base)
    console.log('[info] Fetching historical OrderPlaced events...');
    await fetchHistoricalOrders(provider, currentBlock);
    console.log(`[info] Loaded ${state.openOrders.size} existing pending orders`);

    // Step 2: Subscribe to new OrderPlaced events in real-time
    console.log('[info] Subscribing to new OrderPlaced events...');
    const orderPlacedUnsub = subscribeToOrderPlaced(provider, onNewOrder);

    // Step 3: Subscribe to Fill events to remove completed orders
    console.log('[info] Subscribing to Fill events...');
    const fillEventUnsub = subscribeToFillEvents(provider);

    // Return stop function that unsubscribes from all listeners
    state.unsubscribe = () => {
      orderPlacedUnsub();
      fillEventUnsub();
      state.isRunning = false;
      console.log('[info] Pending orders listener stopped');
    };

    return state.unsubscribe;
  } catch (error: any) {
    console.error('[error] Failed to start pending orders listener:', error.message);
    state.isRunning = false;
    return () => {};
  }
}

/**
 * Stop the pending orders listener.
 */
export function stopPendingOrdersListener(): void {
  if (state.unsubscribe) {
    state.unsubscribe();
  }
}

/**
 * Fetch historical OrderPlaced events from the last N blocks.
 * This helps us load any pending orders that were created before the bot started.
 */
async function fetchHistoricalOrders(
  provider: ethers.Provider,
  currentBlock: number
): Promise<void> {
  try {
    // Look back 1000 blocks (≈33 minutes on Base at 2 sec/block)
    const fromBlock = Math.max(0, currentBlock - 1000);

    // Try multiple possible event signatures for OrderPlaced/OrderCreated
    const eventSignatures = [
      ethers.id('OrderPlaced(bytes32,address)'),
      ethers.id('OrderCreated(bytes32,address)'),
      ethers.id('OrderPlaced(bytes32,address,uint256,uint256)'),
    ];

    for (const eventSig of eventSignatures) {
      try {
        // Suppress ethers console warnings about event decoding
        const originalError = console.error;
        console.error = (...args: any[]) => {
          const message = args[0]?.toString() || '';
          if (!message.includes('Failed to decode') && !message.includes('BUFFER_OVERRUN')) {
            originalError.apply(console, args);
          }
        };

        const logs = await provider.getLogs({
          address: UNISWAPX_PRIORITY_REACTOR_BASE,
          topics: [eventSig],
          fromBlock,
          toBlock: 'latest',
        });

        // Restore console.error
        console.error = originalError;

        if (logs.length > 0) {
          console.log(`[info] Found ${logs.length} events with signature ${eventSig.slice(0, 10)}...`);

          // Parse and add to open orders store
          logs.forEach((log) => {
            try {
              const orderHash = log.topics[1]; // First indexed param
              const swapper = log.topics[2] ? '0x' + log.topics[2].slice(-40) : 'unknown';

              // Skip if already in store
              if (!state.openOrders.has(orderHash)) {
                const order: OpenOrder = {
                  orderHash,
                  swapper,
                  nonce: '0',
                  deadline: 0,
                  blockNumber: log.blockNumber,
                  timestamp: Date.now(),
                  rawLog: log,
                };
                state.openOrders.set(orderHash, order);
              }
            } catch (e) {
              // Skip malformed logs
            }
          });
        }
      } catch (e) {
        // Skip this event signature, try next
      }
    }

    if (state.openOrders.size === 0) {
      console.log('[info] ℹ️ No pending OrderPlaced events found in last 1000 blocks');
      console.log('[info] This is normal if no orders are being placed right now');
    }
  } catch (error: any) {
    console.log('[warn] Historical order fetch failed:', error.message);
  }
}

/**
 * Subscribe to real-time OrderPlaced events.
 * 
 * This function sets up a listener for new orders being placed.
 * When a new order is detected, it's added to the open orders store
 * and the callback is invoked.
 */
function subscribeToOrderPlaced(
  provider: ethers.Provider,
  onNewOrder: (orders: Intent[]) => void
): () => void {
  const orderPlacedTopic = ethers.id('OrderPlaced(bytes32,address)');

  // Use polling-based subscription (more compatible with different RPC types)
  let lastCheckedBlock = state.lastSeenBlock;
  let isSubscribed = true;

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
          topics: [orderPlacedTopic],
          fromBlock: lastCheckedBlock + 1,
          toBlock: currentBlock,
        });

        console.error = originalError;

        const newOrders: Intent[] = [];

        logs.forEach((log) => {
          try {
            const orderHash = log.topics[1];
            const swapper = '0x' + log.topics[2].slice(-40);

            // Add to store if not already present
            if (!state.openOrders.has(orderHash)) {
              const order: OpenOrder = {
                orderHash,
                swapper,
                nonce: '0',
                deadline: 0,
                blockNumber: log.blockNumber,
                timestamp: Date.now(),
                rawLog: log,
              };
              state.openOrders.set(orderHash, order);

              // Log new order
              console.log(
                `[info] 🆕 New pending order detected: ${orderHash.slice(0, 10)}... from ${swapper.slice(0, 10)}...`
              );

              // Create Intent from order (basic conversion)
              const intent: Intent = {
                id: `uniswapx:${orderHash}`,
                maker: swapper,
                sellToken: '0x0000000000000000000000000000000000000000', // Placeholder
                buyToken: '0x0000000000000000000000000000000000000000', // Placeholder
                sellAmount: BigInt(0),
                minBuyAmount: BigInt(0),
                deadline: 0,
                status: 'pending',
                createdAt: Math.floor(Date.now() / 1000),
              };

              newOrders.push(intent);
            }
          } catch (e) {
            // Skip malformed logs
          }
        });

        lastCheckedBlock = currentBlock;

        // Invoke callback with new orders if any were found
        if (newOrders.length > 0) {
          console.log(`[info] Callback invoked with ${newOrders.length} new orders`);
          onNewOrder(newOrders);
        }
      }
    } catch (error: any) {
      console.warn('[warn] Error polling OrderPlaced events:', error.message);
    }
  }, 5000); // Poll every 5 seconds

  return () => {
    isSubscribed = false;
    clearInterval(pollInterval);
    console.log('[info] OrderPlaced event subscription stopped');
  };
}

/**
 * Subscribe to Fill events to track when orders are completed.
 * When an order is filled, remove it from the open orders store.
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

            // Remove from open orders if present
            if (state.openOrders.has(orderHash)) {
              const order = state.openOrders.get(orderHash)!;
              state.openOrders.delete(orderHash);

              console.log(
                `[info] ✅ Order filled: ${orderHash.slice(0, 10)}... (was from ${order.swapper.slice(0, 10)}...)`
              );
              console.log(`[info] Open orders remaining: ${state.openOrders.size}`);
            }
          } catch (e) {
            // Skip malformed logs
          }
        });

        lastCheckedBlock = currentBlock;
      }
    } catch (error: any) {
      console.warn('[warn] Error polling Fill events:', error.message);
    }
  }, 5000); // Poll every 5 seconds (same cadence as OrderPlaced polling)

  return () => {
    isSubscribed = false;
    clearInterval(pollInterval);
    console.log('[info] Fill event subscription stopped');
  };
}

/**
 * Get current open orders from the store.
 * 
 * @returns Array of pending orders
 */
export function getOpenOrders(): OpenOrder[] {
  return Array.from(state.openOrders.values());
}

/**
 * Get count of open orders.
 */
export function getOpenOrdersCount(): number {
  return state.openOrders.size;
}

/**
 * Get open orders as Intent array for the matcher.
 */
export function getOpenOrdersAsIntents(): Intent[] {
  return Array.from(state.openOrders.values()).map((order) => ({
    id: `uniswapx:${order.orderHash}`,
    maker: order.swapper,
    sellToken: '0x0000000000000000000000000000000000000000', // TODO: Extract from event data
    buyToken: '0x0000000000000000000000000000000000000000', // TODO: Extract from event data
    sellAmount: BigInt(0), // TODO: Extract from event data
    minBuyAmount: BigInt(0), // TODO: Extract from event data
    deadline: order.deadline,
    status: 'pending',
    createdAt: Math.floor(order.timestamp / 1000),
  }));
}

/**
 * Manually add an order to the store (for testing).
 */
export function addOpenOrder(order: OpenOrder): void {
  state.openOrders.set(order.orderHash, order);
  console.log(`[info] Added order to open orders: ${order.orderHash.slice(0, 10)}...`);
  console.log(`[info] Total open orders: ${state.openOrders.size}`);
}

/**
 * Manually remove an order from the store (for testing).
 */
export function removeOpenOrder(orderHash: string): void {
  if (state.openOrders.has(orderHash)) {
    state.openOrders.delete(orderHash);
    console.log(`[info] Removed order from open orders: ${orderHash.slice(0, 10)}...`);
    console.log(`[info] Total open orders: ${state.openOrders.size}`);
  }
}
