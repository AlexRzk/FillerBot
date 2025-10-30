/**
 * src/simulator/simulator.ts
 * PURPOSE: Simulate plan execution and calculate profitability.
 * REWRITTEN: To use aggregator's transaction data (not settlement contract).
 *
 * This simulator:
 * 1. Takes plan.quote.txData (the actual swap from aggregator)
 * 2. Performs a staticCall to validate it won't revert
 * 3. Estimates gas for the transaction
 * 4. Returns SimulationResult (success, gasEstimate, l1Fee)
 */

import { Plan } from '../planner/planner';
import { getL1Fee, getProvider, getSigner } from '../eth/provider';
import logger from '../logger';
import { SAFETY_CONFIG } from '../config/safety';

export interface SimulationResult {
  success: boolean; // Did the staticCall succeed?
  expectedProfitToken: bigint; // Profit in the output token (from plan.quote.amountOut - intent.minBuyAmount)
  gasEstimate: bigint;
  l1Fee: bigint;
  error?: string;
}

/**
 * Simulates the aggregator's proposed transaction via staticCall.
 * 
 * @param plan The plan with quote.txData and quote.txTo
 * @returns SimulationResult with success/failure and gas estimates
 */
export async function simulatePlan(plan: Plan): Promise<SimulationResult> {
  logger.info(`Simulating plan: ${plan.id}`);
  const provider = getProvider();
  const signer = getSigner();
  const fillerAddress = await signer.getAddress();

  const { txTo, txData, amountOut } = plan.quote;

  try {
    // 1. REAL SIMULATION via staticCall
    logger.debug(`[simulator] Performing staticCall for plan: ${plan.id}`);

    await provider.call({
      to: txTo,
      from: fillerAddress,
      data: txData,
    });

    logger.info(`[simulator] ✅ staticCall PASSED for plan: ${plan.id}`);

    // 2. GAS ESTIMATION
    const [gasEstimate, l1Fee] = await Promise.all([
      provider.estimateGas({
        to: txTo,
        from: fillerAddress,
        data: txData,
      }),
      getL1Fee(txData),
    ]);

    // Apply gas buffer
    const bufferedGasEstimate = (gasEstimate * BigInt(Math.floor(SAFETY_CONFIG.GAS_BUFFER_MULTIPLIER * 100))) / 100n;

    // Profit in output token
    const expectedProfitToken = amountOut - plan.intent.minBuyAmount;

    return {
      success: true,
      expectedProfitToken,
      gasEstimate: bufferedGasEstimate,
      l1Fee,
    };
  } catch (error: any) {
    const revertReason = error.reason || error.message || 'Unknown error';
    logger.warn(`[simulator] ❌ staticCall FAILED for plan ${plan.id}: ${revertReason}`);
    return {
      success: false,
      expectedProfitToken: 0n,
      gasEstimate: 0n,
      l1Fee: 0n,
      error: revertReason,
    };
  }
}
