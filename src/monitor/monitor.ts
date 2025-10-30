/**
 * src/monitor/monitor.ts
 * PURPOSE: Main orchestration loop with integrated safety systems.
 * ---
 * * CRITICAL FIX: This file has been rewritten to align with the
 * aggregator/planner architecture. It no longer uses the 'matcher'
 * to find pairs, but instead tries to fill *each* pending intent
 * individually.
 */

import { saveIntent, getPendingIntents, saveRun } from '../db/sqlite';
import { startMockFeed } from '../listener/mockFeed';
// Import the real feed listeners
import { startPendingOrdersListener, getOpenOrdersAsIntents, stopPendingOrdersListener } from '../listener/pendingOrdersListener';
// import { startUniswapXListener } from '../listener/uniswapXFeed'; // Assuming you might have this
import { buildPlan } from '../planner/planner';
import { isProfitable, simulatePlan } from '../simulator/simulator';
import { submitPlan } from '../submitter/submitter';
import { getGasPrice, getProvider } from '../eth/provider';
import { formatAmount } from '../utils/eth';
import { config } from '../config';
import logger from '../logger';
import { PriceOracleService } from '../services/priceOracleService';
import { validateTrade, logRejectedTrade } from '../utils/tradeValidator';
import { circuitBreaker } from '../utils/circuitBreaker';
import { SAFETY_CONFIG } from '../config/safety';
import { Intent } from '../models/intent';

interface MonitorState {
  isRunning: boolean;
  cycleCount: number;
  lastError?: string;
}

const state: MonitorState = {
  isRunning: false,
  cycleCount: 0,
};

let priceOracleService: PriceOracleService | null = null;
let stopFeedListener: (() => void) | null = null;

export async function startMonitor(
  settlementAddress: string
): Promise<void> {
  if (state.isRunning) {
    logger.warn('Monitor already running');
    return;
  }

  state.isRunning = true;
  logger.info('Monitor started');
  const provider = getProvider();

  if (config.INTENT_FEED_SOURCE === 'real') {
    if (!config.WS_RPC_URL) {
      throw new Error('Real feed requires WS_RPC_URL (WebSocket RPC)');
    }
    
    // 1. Start Price Oracle
    priceOracleService = new PriceOracleService(provider);
    priceOracleService.start(60000); // Update prices every minute
    logger.info('[safety] Price oracle service started');

    // 2. Log Safety Config
    logger.info(`[safety] Circuit breaker: ${circuitBreaker.isPaused() ? '🛑 PAUSED' : '✅ ACTIVE'}`);
    logger.info(`[safety] Max position size: $${SAFETY_CONFIG.MAX_POSITION_SIZE_USD}`);
    logger.info(`[safety] Min profit: $${SAFETY_CONFIG.MIN_PROFIT_USD}`);

    // 3. Start REAL Feed
    logger.info('Using REAL intent feed from UniswapX mempool listener.');
    // CORRECTED: Use startPendingOrdersListener
    stopFeedListener = await startPendingOrdersListener(
      provider,
      config.WS_RPC_URL,
      (intents: Intent[]) => {
        logger.info(`[feed] Received ${intents.length} new intents from mempool`);
        intents.forEach(saveIntent);
      }
    );

  } else {
    logger.info('Using MOCK intent feed from local JSON file.');
    logger.info('[safety] Price oracle service is DISABLED in mock mode.');
    stopFeedListener = startMockFeed(saveIntent, config.MONITOR_INTERVAL_MS);
  }

  // Monitor loop
  const loop = async () => {
    if (!state.isRunning) {
      logger.info('Monitor loop stopped');
      return;
    }

    try {
      state.cycleCount++;
      logger.debug(`Monitor cycle #${state.cycleCount}`);

      // CORRECTED: Get intents from the correct listener source
      const pendingIntents = (config.INTENT_FEED_SOURCE === 'real')
        ? getOpenOrdersAsIntents()
        : getPendingIntents();

      if (pendingIntents.length === 0) {
        logger.debug('No pending intents, waiting for next cycle...');
        setTimeout(loop, config.MONITOR_INTERVAL_MS);
        return;
      }
      logger.info(`📊 Cycle #${state.cycleCount}: Analyzing ${pendingIntents.length} pending intents`);

      // ---
      // CORRECTED LOGIC: Iterate single intents, not pairs
      // ---
      const gasPrice = await getGasPrice();
      let submitted = false;

      for (const intent of pendingIntents) {
        if (submitted) break; // Only submit one trade per cycle
        if (intent.status !== 'pending') continue;

        try {
          // 1. Build Plan
          logger.debug(`[planner] Building plan for intent: ${intent.id}`);
          const plan = await buildPlan(intent);

          // 2. Simulate Plan
          logger.debug(`[simulator] Simulating plan: ${plan.id}`);
          // NOTE: This simulation is still incomplete (see "Remaining Issues")
          const simulation = await simulatePlan(plan, settlementAddress); 

          if (!simulation.success) {
            logger.warn(`[simulator] ❌ Simulation FAILED for plan ${plan.id}: ${simulation.error}`);
            continue;
          }
          logger.info(`[simulator] ✅ Simulation SUCCEEDED for plan ${plan.id}`);

          // 3. Check Profitability
          if (!isProfitable(simulation, gasPrice, config.MIN_PROFIT_THRESHOLD)) {
            logger.warn(`[Monitor] Plan ${plan.id} is not profitable after gas. Net profit < ${config.MIN_PROFIT_THRESHOLD} wei.`);
            continue;
          }

          // 4. Final Safety Validation
          if (config.INTENT_FEED_SOURCE === 'real') {
              if (circuitBreaker.isPaused()) {
                logger.warn(`[safety] ❌ Trade blocked: Circuit breaker is active - ${circuitBreaker.getState().reason}`);
                break; 
              }
              logger.info(`[safety] Validating trade against safety limits for plan ${plan.id}...`);
              const validation = await validateTrade(plan.intent, simulation, provider);
              
              if (!validation.isValid) {
                logger.warn(`[safety] ❌ Plan ${plan.id} rejected: ${validation.reason}`);
                logRejectedTrade(plan.intent, validation.reason || 'Unknown');
                circuitBreaker.recordTrade(0, false, validation.reason);
                continue; 
              }
              logger.info(`[safety] ✅ Plan ${plan.id} validation passed`);
          }
          
          // 5. Submit
          logger.info(`[safety] 🚀 Submitting trade for plan ${plan.id} (all safety checks passed)`);
          
          // Pass plan and simulation result to submitPlan
          const submissionResult = await submitPlan(plan, simulation);

          if (submissionResult.success) {
            logger.info(`✅ Plan submitted: ${plan.id}, tx: ${submissionResult.txHash}`);
            logger.info(`💰 Gross Profit: (${formatAmount(simulation.expectedProfit, 18)} mock ETH)`);

            if(config.INTENT_FEED_SOURCE === 'real') {
              circuitBreaker.recordTrade(0, true);
            }
            
            saveRun({
              id: plan.id,
              intentIds: [plan.intent.id], // Only one intent
              status: 'executed',
              expectedProfit: simulation.expectedProfit,
              actualProfit: simulation.expectedProfit, // Mock
              gasUsed: simulation.gasEstimate,
              txHash: submissionResult.txHash,
              createdAt: Math.floor(Date.now() / 1000),
              updatedAt: Math.floor(Date.now() / 1000),
            });

            plan.intent.status = 'executed';
            saveIntent(plan.intent);
            
            submitted = true; // Stop processing this cycle
            
          } else {
            logger.error(`❌ Plan submission failed: ${submissionResult.error}`);
            state.lastError = submissionResult.error;
            if(config.INTENT_FEED_SOURCE === 'real') {
              circuitBreaker.recordTrade(0, false, submissionResult.error);
            }
          }

        } catch (error: any) {
          logger.error(`[Monitor] Error processing intent ${intent.id}: ${error.message}`);
          intent.status = 'failed'; // Mark as failed to avoid re-processing
          saveIntent(intent);
        }
      } 

      if (!submitted) {
        logger.debug('[Monitor] No profitable and valid plans were submitted this cycle.');
      }

      setTimeout(loop, config.MONITOR_INTERVAL_MS);
    } catch (error: any) {
      logger.error(`Monitor cycle error: ${error.message}`);
      state.lastError = String(error);
      setTimeout(loop, config.MONITOR_INTERVAL_MS);
    }
  };

  loop();
}

export function stopMonitor(): void {
  logger.info('Stopping monitor...');
  state.isRunning = false;

  if (priceOracleService) {
    priceOracleService.stop();
    priceOracleService = null;
    logger.info('[safety] Price oracle service stopped');
  }
  
  // CORRECTED: Stop the correct listener
  if (stopFeedListener) {
    stopFeedListener();
    stopFeedListener = null;
  }
  
  // Also explicitly stop the mempool listener just in case
  stopPendingOrdersListener();

  const stats = circuitBreaker.getStats();
  logger.info('[stats] Final Statistics:');
  logger.info(`[stats] Total trades: ${stats.totalTrades}`);
  logger.info(`[stats] Successful: ${stats.successfulTrades}, Failed: ${stats.failedTrades}`);
  // ... (rest of stats)

  logger.info('Monitor stopped');
}

export function getMonitorStatus() {
  return {
    running: state.isRunning,
    cycleCount: state.cycleCount,
    lastError: state.lastError,
  };
}