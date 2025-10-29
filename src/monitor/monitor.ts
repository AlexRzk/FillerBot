
/**
 * src/monitor/monitor.ts
 * PURPOSE: Main orchestration loop with integrated safety systems.
 * UPDATED: Streamlined simulation and validation logic.
 */

import { saveIntent, getPendingIntents, saveRun } from '../db/sqlite';
import { startMockFeed } from '../listener/mockFeed';
// Note: Assuming you have a listener that uses the orderbook
// If you are using 'realFeed', ensure it's imported here instead of 'mockFeed'
import { startOrderbookListener } from '../listener/orderbook';
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
// You need a way to stop the listener, but startOrderbookListener doesn't return one.
// We'll assume it runs indefinitely for now.

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
  priceOracleService = new PriceOracleService(provider);
  priceOracleService.start(60000); // Update prices every minute
  logger.info('[safety] Price oracle service started');

  logger.info(`[safety] Circuit breaker: ${circuitBreaker.isPaused() ? '🛑 PAUSED' : '✅ ACTIVE'}`);
  logger.info(`[safety] Max position size: $${SAFETY_CONFIG.MAX_POSITION_SIZE_USD}`);
  logger.info(`[safety] Min profit: $${SAFETY_CONFIG.MIN_PROFIT_USD}`);
  logger.info(`[safety] Max loss/hour: $${SAFETY_CONFIG.MAX_LOSS_PER_HOUR_USD}`);

  // Start the appropriate intent feed
  if (config.INTENT_FEED_SOURCE === 'real') {
    if (!config.ORDERBOOK_API_KEY || !config.ORDERBOOK_WS_URL || !config.UNISWAPX_WEBHOOK_PORT) {
      throw new Error('Real feed requires ORDERBOOK_API_KEY, ORDERBOOK_WS_URL, and UNISWAPX_WEBHOOK_PORT');
    }
    logger.info('Using REAL intent feed from orderbook WebSocket/webhook.');
    // Assuming you have one primary listener. 'startOrderbookListener' is from your index.ts
    // If you are using the webhook listener from uniswapXFeed.ts:
    // startUniswapXListener(config.UNISWAPX_WEBHOOK_PORT, saveIntent);
    // If you are using the websocket listener from orderbook.ts:
    startOrderbookListener(config.ORDERBOOK_API_KEY, config.ORDERBOOK_WS_URL, saveIntent);
    
  } else {
    logger.info('Using MOCK intent feed from local JSON file.');
    startMockFeed(saveIntent, config.MONITOR_INTERVAL_MS);
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

      const pendingIntents = getPendingIntents();
      if (pendingIntents.length === 0) {
        logger.debug('No pending intents, waiting for next cycle...');
        setTimeout(loop, config.MONITOR_INTERVAL_MS);
        return;
      }
      logger.info(`📊 Cycle #${state.cycleCount}: Analyzing ${pendingIntents.length} pending intents`);

      // We are not matching two intents, we are filling one
      // The logic here should be simplified to just build plans for single intents
      // For now, we'll keep the pair logic, but this is a flaw in the 'real' flow
      const candidates = findCandidates(pendingIntents);
      if (candidates.length === 0) {
        logger.debug('No complementary pairs found');
        setTimeout(loop, config.MONITOR_INTERVAL_MS);
        return;
      }
      logger.info(`✅ Found ${candidates.length} candidate pairs for matching`);

      // Build plans
      const plans = candidates.slice(0, 5).map((candidate) =>
        buildPlan(candidate, settlementAddress)
      );
      logger.debug(`Built ${plans.length} plans`);

      // Validate plans (basic)
      const validPlans = plans.filter((plan) => validatePlan(plan));
      if (validPlans.length === 0) {
        logger.debug('No valid plans built.');
        setTimeout(loop, config.MONITOR_INTERVAL_MS);
        return;
      }

      // --- NEW SIMULATION & VALIDATION FLOW ---

      // 1. Simulate all valid plans
      logger.info(`[Monitor] Simulating ${validPlans.length} valid plans...`);
      const simulatedPlans = await simulateAndRankPlans(validPlans, settlementAddress);

      // 2. Filter for SUCCESSFUL simulations (no reverts)
      const successfulSims = simulatedPlans.filter(p => p.result.success);
      if (successfulSims.length === 0) {
        logger.warn('[Monitor] All simulations failed (reverted). No trades to submit.');
        setTimeout(loop, config.MONITOR_INTERVAL_MS);
        return;
      }
      logger.info(`[Monitor] ${successfulSims.length} plans simulated successfully.`);

      // 3. Get gas price for profitability check
      const gasPrice = await getGasPrice();

      // 4. Loop through successful sims and find the first one that is VALID and PROFITABLE
      let submitted = false;
      for (const { plan, result } of successfulSims) {
        
        // 5. Check profitability
        if (!isProfitable(result, gasPrice, config.MIN_PROFIT_THRESHOLD)) {
          logger.warn(`[Monitor] Plan ${plan.id} is not profitable. Net profit < ${config.MIN_PROFIT_THRESHOLD} wei.`);
          continue;
        }
        
        // 6. Check circuit breaker
        if (circuitBreaker.isPaused()) {
          logger.warn(`[safety] ❌ Trade blocked: Circuit breaker is active - ${circuitBreaker.getState().reason}`);
          break; // Stop processing more plans
        }

        // 7. Check safety limits (e.g., max position size)
        logger.info(`[safety] Validating trade against safety limits for plan ${plan.id}...`);
        const validation = await validateTrade(
          plan.intentA, // Assuming A is the primary intent
          result,       // Pass the *real* simulation result
          provider
        );

        if (!validation.isValid) {
          logger.warn(`[safety] ❌ Plan ${plan.id} rejected: ${validation.reason}`);
          logRejectedTrade(plan.intentA, validation.reason || 'Unknown');
          circuitBreaker.recordTrade(0, false, validation.reason);
          continue; // Try the next profitable plan
        }

        logger.info(`[safety] ✅ Plan ${plan.id} validation passed`);
        logger.info(`[safety] Estimated profit: $${validation.estimatedProfitUSD.toFixed(2)}`);
        logger.info(`[safety] Gas cost: $${validation.estimatedGasCostUSD.toFixed(2)}`);
        logger.info(`[safety] Position size: $${validation.positionSizeUSD.toFixed(2)}`);
        
        // 8. (REMOVED) No need for a second simulation, we already did it.
        
        // 9. SUBMIT!
        logger.info(`[safety] 🚀 Submitting trade for plan ${plan.id} (all safety checks passed)`);
        const submissionResult = await submitPlan(plan, settlementAddress);

        if (submissionResult.success) {
          const profitUSD = validation.estimatedProfitUSD;
          logger.info(`✅ Plan submitted: ${plan.id}, tx: ${submissionResult.txHash}`);
          logger.info(`💰 Profit: $${profitUSD.toFixed(2)} (${formatAmount(result.expectedProfit, 18)} ETH)`);

          circuitBreaker.recordTrade(profitUSD, true);

          // Log stats
          const stats = circuitBreaker.getStats();
          logger.info(`[stats] Total trades: ${stats.totalTrades}, Win rate: ${((stats.successfulTrades / (stats.totalTrades || 1)) * 100).toFixed(1)}%`);
          logger.info(`[stats] Total P&L: $${stats.totalProfitUSD.toFixed(2)}`);

          // Save to DB
          saveRun({
            id: plan.id,
            intentIds: [plan.intentA.id, plan.intentB.id],
            status: 'executed',
            expectedProfit: result.expectedProfit,
            actualProfit: result.expectedProfit, // TODO: Calculate from receipt events
            gasUsed: result.gasEstimate,
            txHash: submissionResult.txHash,
            createdAt: Math.floor(Date.now() / 1000),
            updatedAt: Math.floor(Date.now() / 1000),
          });

          // Update intent statuses
          plan.intentA.status = 'executed';
          plan.intentB.status = 'executed';
          saveIntent(plan.intentA);
          saveIntent(plan.intentB);
          
          submitted = true;
          break; // Only submit one plan per cycle
          
        } else {
          logger.error(`❌ Plan submission failed: ${submissionResult.error}`);
          state.lastError = submissionResult.error;
          circuitBreaker.recordTrade(-validation.estimatedGasCostUSD, false, submissionResult.error);
        }
      } // end for loop

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
  
  // TODO: Add stop function for the orderbook listener
  // if (feedStopFn) {
  //   feedStopFn();
  // }

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
