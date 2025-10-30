/**
 * src/monitor/monitor.ts
 * PURPOSE: Main orchestration loop with integrated safety systems.
 * REWRITTEN: To use the single-intent aggregator flow (not pair-matching).
 * 
 * CORRECTED FLOW:
 * For each pending intent:
 *   1. buildPlan(intent) → Get aggregator quote
 *   2. simulatePlan(plan) → Simulate plan.quote.txData via provider.call()
 *   3. validateTrade(plan.intent, simResult) → USD-based safety checks
 *   4. submitPlan(plan, simResult) → Submit to blockchain (standard or Flashbots)
 */

import { saveIntent, getPendingIntents, saveRun } from '../db/sqlite';
import { startMockFeed } from '../listener/mockFeed';
import { startPendingOrdersListener } from '../listener/pendingOrdersListener';
import { buildPlan } from '../planner/planner';
import { simulatePlan } from '../simulator/simulator';
import { submitPlan } from '../submitter/submitter';
import { getProvider } from '../eth/provider';
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
let stopFeedListener: (() => void) | null = null;

/**
 * Start the monitor loop with the corrected single-intent aggregator flow.
 */
export async function startMonitor(_settlementAddress: string): Promise<void> {
  if (state.isRunning) {
    logger.warn('Monitor already running');
    return;
  }

  state.isRunning = true;
  logger.info('✅ Monitor started');
  const provider = getProvider();

  // Start Price Oracle (if in real mode)
  if (config.INTENT_FEED_SOURCE === 'real') {
    priceOracleService = new PriceOracleService(provider);
    priceOracleService.start(60000);
    logger.info('[safety] Price oracle service started');
    logger.info(`[safety] Circuit breaker: ${circuitBreaker.isPaused() ? '🛑 PAUSED' : '✅ ACTIVE'}`);
    logger.info(`[safety] Max position: $${SAFETY_CONFIG.MAX_POSITION_SIZE_USD}`);
    logger.info(`[safety] Min profit: $${SAFETY_CONFIG.MIN_PROFIT_USD}`);
  } else {
    logger.info('Using MOCK intent feed (price oracle disabled in mock mode)');
  }

  // Start Intent Feed
  if (config.INTENT_FEED_SOURCE === 'real') {
    if (!config.WS_RPC_URL) {
      throw new Error('Real feed requires WS_RPC_URL (WebSocket RPC URL)');
    }
    logger.info('Starting REAL mempool listener...');
    stopFeedListener = await startPendingOrdersListener(provider, config.WS_RPC_URL, (intents) => {
      intents.forEach(saveIntent);
    });
  } else {
    logger.info('Starting MOCK intent feed...');
    stopFeedListener = startMockFeed(saveIntent, config.MONITOR_INTERVAL_MS);
  }

  // Main Monitor Loop
  const loop = async () => {
    if (!state.isRunning) {
      logger.info('Monitor loop stopped');
      return;
    }

    try {
      state.cycleCount++;
      const pendingIntents = getPendingIntents();

      if (pendingIntents.length === 0) {
        logger.debug('[monitor] No pending intents');
        setTimeout(loop, config.MONITOR_INTERVAL_MS);
        return;
      }

      logger.info(`📊 Cycle #${state.cycleCount}: Analyzing ${pendingIntents.length} pending intents`);

      let submitted = false;
      for (const intent of pendingIntents) {
        if (submitted) break;
        if (intent.status !== 'pending') continue;

        try {
          logger.debug(`[monitor] Processing intent: ${intent.id}`);

          // 1. Build Plan (get aggregator quote)
          const plan = await buildPlan(intent);
          logger.info(`[monitor] Plan built: ${plan.id}, profit_token=${plan.expectedProfit.toString()}`);

          // 2. Simulate Plan (staticCall the aggregator's txData)
          const simResult = await simulatePlan(plan);

          if (!simResult.success) {
            logger.warn(`[monitor] Simulation FAILED: ${simResult.error}`);
            intent.status = 'failed';
            saveIntent(intent);
            continue;
          }

          logger.info(`[monitor] ✅ Simulation passed, gas=${simResult.gasEstimate.toString()}`);

          // 3. Validate Trade (USD-based checks + safety limits)
          if (config.INTENT_FEED_SOURCE === 'real') {
            if (circuitBreaker.isPaused()) {
              logger.warn(`[safety] ❌ Circuit breaker active: ${circuitBreaker.getState().reason}`);
              break;
            }

            const validation = await validateTrade(intent, simResult, provider);

            if (!validation.isValid) {
              logger.warn(`[safety] ❌ Trade rejected: ${validation.reason}`);
              logRejectedTrade(intent, validation.reason || 'Unknown');
              circuitBreaker.recordTrade(0, false, validation.reason);
              continue;
            }

            logger.info(`[safety] ✅ Trade valid, profit_usd=$${validation.estimatedProfitUSD.toFixed(2)}`);
          }

          // 4. Submit
          logger.info(`[monitor] 🚀 Submitting plan ${plan.id}...`);
          const submissionResult = await submitPlan(plan, simResult);

          if (submissionResult.success) {
            logger.info(`✅ Plan submitted! TX: ${submissionResult.txHash || submissionResult.bundleHash}`);

            saveRun({
              id: plan.id,
              intentIds: [intent.id],
              status: 'executed',
              expectedProfit: plan.expectedProfit.toString(),
              actualProfit: plan.expectedProfit.toString(),
              gasUsed: simResult.gasEstimate.toString(),
              txHash: submissionResult.txHash || submissionResult.bundleHash || 'pending',
              createdAt: Math.floor(Date.now() / 1000),
              updatedAt: Math.floor(Date.now() / 1000),
            });

            intent.status = 'executed';
            saveIntent(intent);
            submitted = true;
          } else {
            logger.error(`❌ Submission failed: ${submissionResult.error}`);
            state.lastError = submissionResult.error;
          }
        } catch (error: any) {
          logger.error(`[monitor] Error: ${error.message}`);
          intent.status = 'failed';
          saveIntent(intent);
        }
      }

      setTimeout(loop, config.MONITOR_INTERVAL_MS);
    } catch (error: any) {
      logger.error(`[monitor] Cycle error: ${error.message}`);
      state.lastError = String(error);
      setTimeout(loop, config.MONITOR_INTERVAL_MS);
    }
  };

  loop();
}

/**
 * Stop the monitor loop.
 */
export function stopMonitor(): void {
  logger.info('Stopping monitor...');
  state.isRunning = false;

  if (priceOracleService) {
    priceOracleService.stop();
    priceOracleService = null;
  }

  if (stopFeedListener) {
    stopFeedListener();
    stopFeedListener = null;
  }

  const stats = circuitBreaker.getStats();
  logger.info('[stats] Total: ' + stats.totalTrades);
  logger.info('[stats] Success: ' + stats.successfulTrades);
  logger.info('[stats] Profit: $' + stats.totalProfitUSD.toFixed(2));

  logger.info('Monitor stopped');
}