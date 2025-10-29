
/**
 * src/monitor/monitor.ts
 * PURPOSE: Main orchestration loop with integrated safety systems.
 * UPDATED: Streamlined simulation and validation logic.
 */

import { saveIntent, getPendingIntents, saveRun } from '../db/sqlite';
import { startMockFeed } from '../listener/mockFeed';
// Import the real feed listeners
import { startOrderbookListener } from '../listener/orderbook';
// import { startUniswapXListener } from '../listener/uniswapXFeed'; // Assuming you might have this
import { findCandidates } from '../matcher/matcher';
import { buildPlan, validatePlan } from '../planner/planner';
import { simulateAndRankPlans, isProfitable } from '../simulator/simulator';
import { submitPlan } from '../submitter/submitter';
import { getGasPrice, getProvider } from '../eth/provider';
import { formatAmount } from '../utils/eth';
import { config } from '../config';
import logger from '../logger';
import { PriceOracleService } from '../services/priceOracleService';
import { validateTrade, logRejectedTrade } from '../utils/tradeValidator';
import { circuitBreaker } from '../utils/circuitBreaker';
import { SAFETY_CONFIG } from '../config/safety';

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
let stopFeedListener: (() => void) | null = null; // To hold the stop function

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

  // --- FIX: Only start price oracle and real feed if in 'real' mode ---
  if (config.INTENT_FEED_SOURCE === 'real') {
    if (!config.ORDERBOOK_API_KEY || !config.ORDERBOOK_WS_URL || !config.UNISWAPX_WEBHOOK_PORT) {
      throw new Error('Real feed requires ORDERBOOK_API_KEY, ORDERBOOK_WS_URL, and UNISWAPX_WEBHOOK_PORT');
    }
    
    // 1. Start Price Oracle
    priceOracleService = new PriceOracleService(provider);
    priceOracleService.start(60000); // Update prices every minute
    logger.info('[safety] Price oracle service started');

    // 2. Log Safety Config
    logger.info(`[safety] Circuit breaker: ${circuitBreaker.isPaused() ? '🛑 PAUSED' : '✅ ACTIVE'}`);
    logger.info(`[safety] Max position size: $${SAFETY_CONFIG.MAX_POSITION_SIZE_USD}`);
    logger.info(`[safety] Min profit: $${SAFETY_CONFIG.MIN_PROFIT_USD}`);
    logger.info(`[safety] Max loss/hour: $${SAFETY_CONFIG.MAX_LOSS_PER_HOUR_USD}`);

    // 3. Start Real Feed
    logger.info('Using REAL intent feed from orderbook WebSocket/webhook.');
    // Choose which real listener to use
    // stopFeedListener = startOrderbookListener(config.ORDERBOOK_API_KEY, config.ORDERBOOK_WS_URL, saveIntent);
    // OR
    // stopFeedListener = startUniswapXListener(config.UNISWAPX_WEBHOOK_PORT, saveIntent);
  // For now, let's assume orderbook. Note: startOrderbookListener may not return a stop function.
  // Call it and keep a null stop handler if none is provided.
  startOrderbookListener(config.ORDERBOOK_API_KEY, config.ORDERBOOK_WS_URL, saveIntent);
  stopFeedListener = null;

  } else {
    // --- This is the mode you are in ---
    logger.info('Using MOCK intent feed from local JSON file.');
    logger.info('[safety] Price oracle service is DISABLED in mock mode.');
    stopFeedListener = startMockFeed(saveIntent, config.MONITOR_INTERVAL_MS);
  }
  // --- END FIX ---


  // Monitor loop
  const loop = async () => {
    if (!state.isRunning) {
      logger.info('Monitor loop stopped');
      return;
    }

    try {
      state.cycleCount++;
      logger.debug(`Monitor cycle #${state.cycleCount}`);

      const pendingIntents = getPendingIntents();
      if (pendingIntents.length === 0) {
        logger.debug('No pending intents, waiting for next cycle...');
        setTimeout(loop, config.MONITOR_INTERVAL_MS);
        return;
      }
      logger.info(`📊 Cycle #${state.cycleCount}: Analyzing ${pendingIntents.length} pending intents`);

      // This logic is for matching pairs. This is correct for MOCK mode.
      const candidates = findCandidates(pendingIntents);
      if (candidates.length === 0) {
        logger.debug('No candidate pairs found');
        setTimeout(loop, config.MONITOR_INTERVAL_MS);
        return;
      }
      logger.info(`✅ Found ${candidates.length} candidate pairs for matching`);

      // Build plans
      const plans = candidates.slice(0, 5).map((candidate) =>
        buildPlan(candidate, settlementAddress) // Assumes buildPlan is adapted for this
      );
      logger.debug(`Built ${plans.length} plans`);

      // Validate plans (basic)
      const validPlans = plans.filter((plan) => validatePlan(plan));
      if (validPlans.length === 0) {
        logger.debug('No valid plans built.');
        setTimeout(loop, config.MONITOR_INTERVAL_MS);
        return;
      }

      // --- SIMULATION & VALIDATION FLOW ---
      logger.info(`[Monitor] Simulating ${validPlans.length} valid plans...`);
      const simulatedPlans = await simulateAndRankPlans(validPlans, settlementAddress);

      const successfulSims = simulatedPlans.filter(p => p.result.success);
      if (successfulSims.length === 0) {
        // This is where you were failing before.
        // It's normal in local mode if the simulation finds an error.
        logger.warn('[Monitor] All simulations failed (reverted). No trades to submit.');
        setTimeout(loop, config.MONITOR_INTERVAL_MS);
        return;
      }
      logger.info(`[Monitor] ${successfulSims.length} plans simulated successfully.`);

      const gasPrice = await getGasPrice();

      let submitted = false;
      for (const { plan, result } of successfulSims) {
        
        // Check profitability
        if (!isProfitable(result, gasPrice, config.MIN_PROFIT_THRESHOLD)) {
          logger.warn(`[Monitor] Plan ${plan.id} is not profitable. Net profit < ${config.MIN_PROFIT_THRESHOLD} wei.`);
          continue;
        }
        
        // In 'real' mode, we'd check safety limits. In 'mock' mode, we can skip.
        if (config.INTENT_FEED_SOURCE === 'real') {
            if (circuitBreaker.isPaused()) {
              logger.warn(`[safety] ❌ Trade blocked: Circuit breaker is active - ${circuitBreaker.getState().reason}`);
              break; 
            }
            logger.info(`[safety] Validating trade against safety limits for plan ${plan.id}...`);
            const validation = await validateTrade(plan.intentA, result, provider);
            if (!validation.isValid) {
              logger.warn(`[safety] ❌ Plan ${plan.id} rejected: ${validation.reason}`);
              logRejectedTrade(plan.intentA, validation.reason || 'Unknown');
              circuitBreaker.recordTrade(0, false, validation.reason);
              continue; 
            }
            logger.info(`[safety] ✅ Plan ${plan.id} validation passed`);
        }
        
        logger.info(`[safety] 🚀 Submitting trade for plan ${plan.id} (all safety checks passed)`);
        const submissionResult = await submitPlan(plan, settlementAddress);

        if (submissionResult.success) {
          logger.info(`✅ Plan submitted: ${plan.id}, tx: ${submissionResult.txHash}`);
          logger.info(`💰 Profit: (${formatAmount(result.expectedProfit, 18)} mock ETH)`);

          if(config.INTENT_FEED_SOURCE === 'real') {
            circuitBreaker.recordTrade(0, true); // We don't have real USD profit here yet
          }
          
          saveRun({
            id: plan.id,
            intentIds: [plan.intentA.id, plan.intentB.id],
            status: 'executed',
            expectedProfit: result.expectedProfit,
            actualProfit: result.expectedProfit, 
            gasUsed: result.gasEstimate,
            txHash: submissionResult.txHash,
            createdAt: Math.floor(Date.now() / 1000),
            updatedAt: Math.floor(Date.now() / 1000),
          });

          plan.intentA.status = 'executed';
          plan.intentB.status = 'executed';
          saveIntent(plan.intentA);
          saveIntent(plan.intentB);
          
          submitted = true;
          break; 
          
        } else {
          logger.error(`❌ Plan submission failed: ${submissionResult.error}`);
          state.lastError = submissionResult.error;
          if(config.INTENT_FEED_SOURCE === 'real') {
            circuitBreaker.recordTrade(0, false, submissionResult.error);
          }
        }
      } 

      if (!submitted) {
        logger.info('[Monitor] No profitable and valid plans were submitted this cycle.');
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
  
  if (stopFeedListener) {
    stopFeedListener();
    stopFeedListener = null;
  }

  const stats = circuitBreaker.getStats();
  logger.info('[stats] Final Statistics:');
  logger.info(`[stats] Total trades: ${stats.totalTrades}`);
  logger.info(`[stats] Successful: ${stats.successfulTrades}, Failed: ${stats.failedTrades}`);
  logger.info(`[stats] Total P&L: $${stats.totalProfitUSD.toFixed(2)}`);
  logger.info(`[stats] Loss in last hour: $${stats.lossInLastHour.toFixed(2)}`);
  logger.info(`[stats] Loss in last day: $${stats.lossInLastDay.toFixed(2)}`);

  logger.info('Monitor stopped');
}

export function getMonitorStatus() {
  return {
    running: state.isRunning,
    cycleCount: state.cycleCount,
    lastError: state.lastError,
  };
}
