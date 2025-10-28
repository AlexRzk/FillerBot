/**
 * src/simulator/simulator.ts
 * PURPOSE: Simulate plan execution against local mock contracts.
 * Uses ethers callStatic (read-only) to validate execution without broadcasting.
 * 
 * SAFETY: In local mode, this is 100% safe (no state change).
 * Simulation failure means plan would revert on-chain.
 * 
 * TODO: Add support for complex routing simulation
 * TODO: Add price impact simulation from large swaps
 * TODO: Add slippage tolerance validation
 * TODO: Add MEV/sandwich protection checks
 */

import { Plan } from '../planner/planner';

import logger from '../logger';

/**
 * Result of a plan simulation.
 */
export interface SimulationResult {
  // Did the simulation succeed?
  success: boolean;

  // Expected profit if executed (in wei)
  expectedProfit: bigint;

  // Expected gas usage (in wei)
  gasEstimate: bigint;

  // Simulation error details (if failed)
  error?: string;

  // Raw simulation output
  output?: string;
}

/**
 * Simulate a plan using callStatic (read-only contract calls).
 * This is safe and does not broadcast any transactions.
 * 
 * TODO: Implement actual settlement contract simulation
 * Current implementation returns mock result.
 * 
 * @param plan Plan to simulate
 * @param settlementAddress Address of settlement contract
 * @returns Simulation result
 */
export async function simulatePlan(
  plan: Plan,
  _settlementAddress: string
): Promise<SimulationResult> {
  logger.info(`Simulating plan: ${plan.id}`);

  try {
    // TODO: Replace with actual settlement contract ABI and call
    // Example (pseudo-code):
    // const settlementContract = new ethers.Contract(
    //   settlementAddress,
    //   SETTLEMENT_ABI,
    //   provider
    // );
    // const result = await settlementContract.callStatic.settle(
    //   plan.intentA,
    //   plan.intentB
    // );

    // Mock simulation for now
    const mockSuccess = Math.random() > 0.2; // 80% success rate for testing
    
    // Use the expectedProfit from the plan (which is now calculated dynamically)
    const mockProfit = plan.expectedProfit;
    const mockGas = plan.estimatedGas;

    if (mockSuccess) {
      logger.debug(`Simulation succeeded for plan ${plan.id}. Expected profit: ${mockProfit}`);

      return {
        success: true,
        expectedProfit: mockProfit,
        gasEstimate: mockGas,
      };
    } else {
      logger.warn(`Simulation failed for plan ${plan.id}`);

      return {
        success: false,
        expectedProfit: 0n,
        gasEstimate: mockGas,
        error: 'Mock simulation failure',
      };
    }
  } catch (error) {
    logger.error(`Plan simulation error: ${error}`);

    return {
      success: false,
      expectedProfit: 0n,
      gasEstimate: plan.estimatedGas,
      error: String(error),
    };
  }
}

/**
 * Check if a simulation result is profitable.
 * Takes into account gas costs.
 * 
 * @param result Simulation result
 * @param gasPrice Current gas price (in wei per gas)
 * @param minProfit Minimum acceptable profit (in wei)
 * @returns True if profitable
 */
export function isProfitable(
  result: SimulationResult,
  gasPrice: bigint,
  minProfit: bigint
): boolean {
  if (!result.success) {
    return false;
  }

  const gasCost = result.gasEstimate * gasPrice;
  const netProfit = result.expectedProfit - gasCost;

  logger.debug(
    `Profitability check: profit=${result.expectedProfit}, gas_cost=${gasCost}, net=${netProfit}, min=${minProfit}`
  );

  return netProfit >= minProfit;
}

/**
 * Simulate a batch of plans and return the most profitable.
 * 
 * TODO: Add parallel simulation for performance
 * TODO: Add timeout per simulation
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
