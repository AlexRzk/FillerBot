
/**
 * src/simulator/simulator.ts
 * PURPOSE: Simulate plan execution and calculate profitability.
 * UPDATED: Now performs a real staticCall simulation to check for reverts.
 */

import { Plan } from '../planner/planner';
import { getL1Fee, getProvider, getSigner } from '../eth/provider';
import { createSettlementContract, PriorityOrder } from '../contracts/settlementContract';
import { ethers } from 'ethers';
import logger from '../logger';
import { SAFETY_CONFIG } from '../config/safety';

export interface SimulationResult {
  success: boolean; // Did the static call succeed?
  expectedProfit: bigint;
  gasEstimate: bigint;
  l1Fee: bigint;
  error?: string;
}

export async function simulatePlan(
  plan: Plan,
  settlementAddress: string
): Promise<SimulationResult> {
  logger.info(`Simulating plan: ${plan.id}`);
  const provider = getProvider();
  const signer = getSigner();
  const settlementContract = createSettlementContract(settlementAddress, provider); // Use provider for static call

  const order: PriorityOrder = {
    info: ethers.keccak256(ethers.toUtf8Bytes(plan.intent.id)),
    inputToken: plan.intent.sellToken,
    outputToken: plan.intent.buyToken,
    inputAmount: plan.intent.sellAmount,
    minOutputAmount: plan.intent.minBuyAmount,
    swapper: plan.intent.maker,
    deadline: BigInt(plan.intent.deadline),
    fee: BigInt(0), // Assuming no priority fee for this simulation
  };

  const signature = plan.intent.signature || '0x';
  if (signature === '0x') {
    return {
      success: false,
      expectedProfit: 0n,
      gasEstimate: 0n,
      l1Fee: 0n,
      error: 'Missing signature in plan',
    };
  }
  
  const fillerAddress = await signer.getAddress();

  try {
    // 1. --- REAL SIMULATION ---
    // We use staticCall to see if the transaction will revert
    // The signer is passed as the 'from' address in the overrides
    logger.debug(`[simulator] Performing staticCall simulation for plan: ${plan.id}`);
    const txData = settlementContract.interface.encodeFunctionData('execute', [
      [
        order.info,
        order.inputToken,
        order.outputToken,
        order.inputAmount,
        order.minOutputAmount,
        order.swapper,
        order.deadline,
        order.fee,
      ],
      signature,
    ]);

    // provider.call performs an eth_call (static) which will revert if the tx would revert
    await provider.call({ to: settlementAddress, from: fillerAddress, data: txData });
    logger.info(`[simulator] ✅ staticCall simulation SUCCEEDED for plan: ${plan.id}`);

    // 2. --- GAS ESTIMATION ---
    const [gasEstimate, l1Fee] = await Promise.all([
      provider.estimateGas({ to: settlementAddress, from: fillerAddress, data: txData }),
      getL1Fee(txData)
    ]);

    // Apply gas buffer
    const bufferedGasEstimate = (gasEstimate * BigInt(Math.floor(SAFETY_CONFIG.GAS_BUFFER_MULTIPLIER * 100))) / 100n;

    return {
      success: true,
      expectedProfit: plan.expectedProfit,
      gasEstimate: bufferedGasEstimate,
      l1Fee: l1Fee,
    };

  } catch (error: any) {
    // This is the most common case: the staticCall REVERTED
    const revertReason = error.reason || error.message || 'Unknown revert reason';
    logger.warn(`[simulator] ❌ staticCall simulation FAILED for plan ${plan.id}: ${revertReason}`);
    return {
      success: false,
      expectedProfit: 0n,
      gasEstimate: 0n,
      l1Fee: 0n,
      error: revertReason,
    };
  }
}

/**
 * Checks if a simulation result is profitable after all costs.
 */
export function isProfitable(
  result: SimulationResult,
  gasPrice: { maxFeePerGas: bigint, maxPriorityFeePerGas: bigint },
  minProfitWei: bigint
): boolean {
  if (!result.success) {
    return false;
  }

  // Calculate L2 gas cost
  const gasCost = result.gasEstimate * gasPrice.maxFeePerGas;
  // Total cost = L2 gas + L1 data fee
  const totalCost = gasCost + result.l1Fee;
  
  const netProfit = result.expectedProfit - totalCost;

  logger.debug(
    `Profitability check: profit=${result.expectedProfit}, gas_cost=${gasCost}, l1_fee=${result.l1Fee}, total_cost=${totalCost}, net=${netProfit}, min=${minProfitWei}`
  );

  return netProfit >= minProfitWei;
}

/**
 * Simulate all plans and rank them.
 */
export async function simulateAndRankPlans(
  plans: Plan[],
  settlementAddress: string
): Promise<{ plan: Plan; result: SimulationResult }[]> {
  const results = await Promise.all(
    plans.map(async (plan) => ({
      plan,
      result: await simulatePlan(plan, settlementAddress),
    }))
  );

  // Sort by expected profit (highest first)
  results.sort((a, b) => Number(b.result.expectedProfit - a.result.expectedProfit));

  return results;
}
