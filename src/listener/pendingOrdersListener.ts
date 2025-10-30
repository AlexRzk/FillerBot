/**
 * src/listener/pendingOrdersListener.ts
 * CORRIGÉ :
 * 1. Réactivation des arguments de la fonction (provider, wsRpcUrl, onNewOrder).
 * 2. Suppression de l'importation de 'getHardcodedTokenDecimals' (n'existe plus).
 * 3. Suppression du code de logging qui utilisait cette fonction.
 * 4. Réactivation de startMempoolOrderListener et startCowListener.
 */

import { ethers } from 'ethers';
import { Intent } from '../models/intent';
// import { getHardcodedTokenDecimals } from '../utils/priceOracle'; // <-- CORRECTION : Ligne supprimée
import {
  startMempoolOrderListener, // <-- CORRECTION : Réactivé
  stopMempoolOrderListener,
  getPendingMempoolOrdersAsIntents,
  removePendingMempoolOrder,
} from './mempoolOrderListener';
import { startCowListener } from './realFeed';
import { saveIntent } from '../db/sqlite';

const UNISWAPX_PRIORITY_REACTOR_BASE = '0x000000001Ec5656dcdB24D90DFa42742738De729';

/**
 * Pending orders listener state.
 */
interface ListenerState {
  isRunning: boolean;
  mempoolUnsubscribe?: () => void;
  fillEventUnsubscribe?: () => void;
  cowUnsubscribe?: () => void;
  lastSeenBlock: number;
}

const state: ListenerState = {
  isRunning: false,
  lastSeenBlock: 0,
};

/**
 * Start listening to pending orders from UniswapX Priority Reactor.
 */
// --- CORRECTION ICI ---
// Réactivation des arguments wsRpcUrl et onNewOrder
export async function startPendingOrdersListener(
  provider: ethers.Provider,
  wsRpcUrl: string,
  onNewOrder: (orders: Intent[]) => void
): Promise<() => void> {
// --- FIN DE LA CORRECTION ---
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
    // --- CORRECTION ICI ---
    // Réactivation de l'écouteur mempool
    state.mempoolUnsubscribe = await startMempoolOrderListener(wsRpcUrl, onNewOrder);
    console.log('[info] ✅ Mempool listener started successfully');
    // --- FIN DE LA CORRECTION ---

    // Step 2: Subscribe to Fill events for cleanup tracking
    console.log('[info] Subscribing to Fill events for order completion tracking...');
    state.fillEventUnsubscribe = subscribeToFillEvents(provider);
    console.log('[info] ✅ Fill event listener started');

    // ÉTAPE 3 : Démarrer le poller CoW Protocol comme source d'ordres principale
    console.log('[info] Starting CoW orderbook poller as fallback...');
    // --- CORRECTION ICI ---
    // Réactivation du listener CoW
    state.cowUnsubscribe = await startCowListener((intent) => {
      saveIntent(intent); // Sauvegarder directement les intents CoW dans la DB
    });
    console.log('[info] [feed] ✅ CoW orderbook poller started');
    // --- FIN DE LA CORRECTION ---


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
      
      if (state.cowUnsubscribe) {
        state.cowUnsubscribe();
        state.cowUnsubscribe = undefined;
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
  if (state.cowUnsubscribe) {
    state.cowUnsubscribe();
    state.cowUnsubscribe = undefined;
  }
  state.isRunning = false;
}

/**
 * Subscribe to Fill events to track when orders are completed on-chain.
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
            const rawFillerTopic = log.topics[2];
            const rawSwapperTopic = log.topics[3];

            // Extract actual 20-byte addresses from the 32-byte padded topics
            const fillerAddress = ethers.getAddress(`0x${rawFillerTopic.slice(-40)}`);
            const swapperAddress = ethers.getAddress(`0x${rawSwapperTopic.slice(-40)}`);
            
            // Remove from pending mempool orders if present
            const removedOrder = removePendingMempoolOrder(orderHash);

            console.log(
              `[info] ✅ Order filled on-chain: ${orderHash.slice(0, 10)}...`
            );
            console.log(
              `[info]    Filler: ${fillerAddress}`
            );
            console.log(
              `[info]    Swapper: ${swapperAddress}`
            );
            
            // If we had this order in our mempool tracking, log the amounts
            if (removedOrder) {
              const decoded = removedOrder.decodedOrder;
              
              // --- CORRECTION ICI ---
              // Supprimé le code qui utilisait getHardcodedTokenDecimals
              // (lignes 216-227)
              
              console.log(
                `[info]    Input: ${decoded.inputAmount.toString()} (wei) (${decoded.inputToken.slice(0, 10)}...)`
              );
              console.log(
                `[info]    Output: ${decoded.outputAmount.toString()} (wei) (${decoded.outputToken.slice(0, 10)}...)`
              );
              // --- FIN DE LA CORRECTION ---
              
              const rawGain = decoded.outputAmount - decoded.inputAmount;
              if (rawGain > 0n) {
                console.log(
                  `[info]    💰 Potential gain (raw): ${rawGain.toString()}`
                );
              } else if (rawGain < 0n) {
                console.log(
                  `[info]    📉 Potential loss (raw): ${rawGain.toString()}`
                );
              }
            }
          } catch (e: any) {
             console.warn(`[warn] Error processing Fill event log: ${e.message}`);
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