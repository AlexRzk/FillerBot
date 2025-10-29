
/**
 * src/monitor/monitor.ts
 * PURPOSE: Main orchestration loop with integrated safety systems.
 */

import { saveIntent, getPendingIntents, saveRun } from '../db/sqlite';
import { findCandidates } from '../matcher/matcher';
import { buildPlan, validatePlan } from '../planner/planner';
import { simulateAndRankPlans, isProfitable } from '../simulator/simulator';
import { submitPlan } from '../submitter/submitter';
import { getGasPrice, getProvider } from '../eth/provider';
import { formatAmount } from '../utils/eth';
import { config } from '../config';
import logger from '../logger';
import { PriceOracleService } from '../services/priceOracleService';
import { validateTrade, simulateTrade, logRejectedTrade } from '../utils/tradeValidator';
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
  priceOracleService.start(60000);
  logger.info('[safety] Price oracle service started');

  logger.info(`[safety] Circuit breaker: ${circuitBreaker.isPaused() ? '🛑 PAUSED' : '✅ ACTIVE'}`);
  logger.info(`[safety] Max position size: $${SAFETY_CONFIG.MAX_POSITION_SIZE_USD}`);
  logger.info(`[safety] Min profit: $${SAFETY_CONFIG.MIN_PROFIT_USD}`);
  logger.info(`[safety] Max loss/hour: $${SAFETY_CONFIG.MAX_LOSS_PER_HOUR_USD}`);

  const loop = async () => {
    if (!state.isRunning) {
      logger.info('Monitor loop stopped');
      return;
    }

    try {
      state.cycleCount++;
      logger.debug(`Monitor cycle #${state.cycleCount}`);

      const pendingIntents = getPendingIntents();
      logger.debug(`Fetched ${pendingIntents.length} pending intents`);

      if (pendingIntents.length === 0) {
        logger.debug('No pending intents, waiting for next cycle...');
        setTimeout(loop, config.MONITOR_INTERVAL_MS);
        return;
      }

      logger.info(`📊 Cycle #${state.cycleCount}: Analyzing ${pendingIntents.length} pending intents`);

      const candidates = findCandidates(pendingIntents);
      logger.debug(`Found ${candidates.length} candidate pairs`);

      if (candidates.length === 0) {
        logger.debug('No complementary pairs found');
        setTimeout(loop, config.MONITOR_INTERVAL_MS);
        return;
      }

      logger.info(`✅ Found ${candidates.length} candidate pairs for matching`);

      const plans = candidates.slice(0, 5).map((candidate) =>
        buildPlan(candidate, settlementAddress)
      );

      logger.debug(`Built ${plans.length} plans`);

      const validPlans = plans.filter((plan) => validatePlan(plan));
      logger.debug(`${validPlans.length} plans passed validation`);

      if (validPlans.length === 0) {
        setTimeout(loop, config.MONITOR_INTERVAL_MS);
        return;
      }

      const simulatedPlans = await simulateAndRankPlans(validPlans, settlementAddress);
      logger.debug(`Simulated ${simulatedPlans.length} plans`);
      
      if (simulatedPlans.length > 0) {
        const topPlan = simulatedPlans[0];
        const profitEth = Number(topPlan.result.expectedProfit) / 1e18;
        logger.info(`💰 Top plan profit: ${profitEth.toFixed(8)} ETH`);
        logger.debug(
          `   Pair: ${topPlan.plan.intentA.id.slice(0, 8)}... <-> ${topPlan.plan.intentB.id.slice(0, 8)}...`
        );
      }

      const gasPrice = await getGasPrice();
      const profitablePlans = simulatedPlans.filter(({ result }) =>
        isProfitable(result, gasPrice, config.MIN_PROFIT_THRESHOLD)
      );

      logger.info(
        `Found ${profitablePlans.length} profitable plans (min threshold: ${config.MIN_PROFIT_THRESHOLD})`
      );

      if (profitablePlans.length > 0) {
        const topPlan = profitablePlans[0];
        
        if (circuitBreaker.isPaused()) {
          const cbState = circuitBreaker.getState();
          logger.warn(`[safety] ❌ Trade blocked: Circuit breaker is active - ${cbState.reason}`);
          setTimeout(loop, config.MONITOR_INTERVAL_MS);
          return;
        }

        logger.info('[safety] Validating trade against safety limits...');
        const validation = await validateTrade(
          topPlan.plan.intentA,
          topPlan.result.gasEstimate,
          provider
        );

        if (!validation.isValid) {
          logger.warn(`[safety] ❌ Trade rejected: ${validation.reason}`);
          logRejectedTrade(topPlan.plan.intentA, validation.reason || 'Unknown');
          circuitBreaker.recordTrade(0, false, validation.reason);
          setTimeout(loop, config.MONITOR_INTERVAL_MS);
          return;
        }

        logger.info('[safety] ✅ Trade validation passed');
        logger.info(`[safety] Estimated profit: $${validation.estimatedProfitUSD.toFixed(2)}`);
        logger.info(`[safety] Gas cost: $${validation.estimatedGasCostUSD.toFixed(2)}`);
        logger.info(`[safety] Position size: $${validation.positionSizeUSD.toFixed(2)}`);

        if (SAFETY_CONFIG.REQUIRE_SIMULATION) {
          logger.info('[safety] Simulating transaction...');
          const simulation = await simulateTrade(topPlan.plan.intentA, provider);
          
          if (!simulation.success) {
            logger.warn(`[safety] ❌ Simulation failed: ${simulation.reason}`);
            logRejectedTrade(topPlan.plan.intentA, `Simulation failed: ${simulation.reason}`);
            circuitBreaker.recordTrade(0, false, `Simulation: ${simulation.reason}`);
            setTimeout(loop, config.MONITOR_INTERVAL_MS);
            return;
          }
          logger.info('[safety] ✅ Transaction simulation passed');
        }

        logger.info(`[safety] 🚀 Submitting trade (all safety checks passed)`);
        const result = await submitPlan(topPlan.plan, settlementAddress);

        if (result.success) {
          const profitUSD = validation.estimatedProfitUSD;
          logger.info(`✅ Plan submitted: ${topPlan.plan.id}, tx: ${result.txHash}`);
          logger.info(`💰 Profit: $${profitUSD.toFixed(2)} (${formatAmount(topPlan.result.expectedProfit, 18)} ETH)`);

          circuitBreaker.recordTrade(profitUSD, true);

          const stats = circuitBreaker.getStats();
          logger.info(`[stats] Total trades: ${stats.totalTrades}, Win rate: ${((stats.successfulTrades / stats.totalTrades) * 100).toFixed(1)}%`);
          logger.info(`[stats] Total P&L: $${stats.totalProfitUSD.toFixed(2)}`);

          saveRun({
            id: topPlan.plan.id,
            intentIds: [topPlan.plan.intentA.id, topPlan.plan.intentB.id],
            status: 'executed',
            expectedProfit: topPlan.result.expectedProfit,
            actualProfit: topPlan.result.expectedProfit, // TODO: Calculate from receipt
            gasUsed: topPlan.result.gasEstimate,
            txHash: result.txHash,
            createdAt: Math.floor(Date.now() / 1000),
            updatedAt: Math.floor(Date.now() / 1000),
          });

          topPlan.plan.intentA.status = 'executed';
          topPlan.plan.intentB.status = 'executed';
          saveIntent(topPlan.plan.intentA);
          saveIntent(topPlan.plan.intentB);
        } else {
          logger.error(`❌ Plan submission failed: ${result.error}`);
          state.lastError = result.error;
          
          circuitBreaker.recordTrade(-validation.estimatedGasCostUSD, false, result.error);
        }
      }

      setTimeout(loop, config.MONITOR_INTERVAL_MS);
    } catch (error) {
      logger.error(`Monitor cycle error: ${error}`);
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
