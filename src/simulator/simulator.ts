
/**
 * src/simulator/simulator.ts
 * PURPOSE: Simulate plan execution and calculate profitability.
 */

import { Plan } from '../planner/planner';
import { getL1Fee } from '../eth/provider';
import { estimateExecuteGas, PriorityOrder } from '../contracts/settlementContract';
import { getSigner } from '../eth/provider';
import { ethers } from 'ethers';
import logger from '../logger';

export interface SimulationResult {
  success: boolean;
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

  try {
    const signer = getSigner();
    const settlementContract = new ethers.Contract(settlementAddress, [], signer);

    const order: PriorityOrder = {
      info: ethers.keccak256(ethers.toUtf8Bytes(plan.intentA.id)),
      inputToken: plan.intentA.sellToken,
      outputToken: plan.intentA.buyToken,
      inputAmount: plan.intentA.sellAmount,
      minOutputAmount: plan.intentA.minBuyAmount,
      swapper: plan.intentA.maker,
      deadline: BigInt(plan.intentA.deadline),
      fee: BigInt(0),
    };

    const gasEstimate = await estimateExecuteGas(
      settlementContract,
      order,
      plan.signatureA || '0x',
      await signer.getAddress()
    );

    const txData = settlementContract.interface.encodeFunctionData('execute', [order, plan.signatureA || '0x']);
    const l1Fee = await getL1Fee(txData);

    return {
      success: true,
      expectedProfit: plan.expectedProfit,
      gasEstimate,
      l1Fee,
    };
  } catch (error) {
    logger.error(`Plan simulation error: ${error}`);
    return {
      success: false,
      expectedProfit: 0n,
      gasEstimate: 0n,
      l1Fee: 0n,
      error: String(error),
    };
  }
}

export function isProfitable(
  result: SimulationResult,
  gasPrice: { maxFeePerGas: bigint, maxPriorityFeePerGas: bigint },
  minProfit: bigint
): boolean {
  if (!result.success) {
    return false;
  }

  const gasCost = result.gasEstimate * gasPrice.maxFeePerGas;
  const totalCost = gasCost + result.l1Fee;
  const netProfit = result.expectedProfit - totalCost;

  logger.debug(
    `Profitability check: profit=${result.expectedProfit}, gas_cost=${gasCost}, l1_fee=${result.l1Fee}, total_cost=${totalCost}, net=${netProfit}, min=${minProfit}`
  );

  return netProfit >= minProfit;
}

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

  results.sort((a, b) => Number(b.result.expectedProfit - a.result.expectedProfit));

  return results;
}
