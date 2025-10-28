/**
 * src/planner/planner.ts
 * PURPOSE: Convert a candidate pair into an executable plan.
 * Plan includes steps, expected outputs, and gas estimation.
 * 
 * SAFETY: Uses price cache that can be updated with Chainlink oracles.
 */

import { Intent } from '../models/intent';
import { Candidate } from '../matcher/matcher';
import logger from '../logger';
import { getTokenDecimals as getOracleDecimals } from '../utils/priceOracle.js';

/**
 * Token decimal mapping for Optimism mainnet (fallback).
 * Primary decimals come from priceOracle.ts
 */
const TOKEN_DECIMALS: { [address: string]: number } = {
  // Stablecoins (6 decimals)
  '0x7f5c764cbc14f9669b88dc4c52a84e7cffbf05c0': 6, // USDC.e
  '0x0b2c639c533813f4aa9d7837caf62653d097ff85': 6, // USDC
  '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58': 6, // USDT
  '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 18, // DAI (18)
  
  // Main tokens (18 decimals)
  '0x4200000000000000000000000000000000000006': 18, // WETH
  '0x4200000000000000000000000000000000000042': 18, // OP
  '0x68f180fcce6836688e9084f035309e29bf0a2095': 8,  // WBTC
};

/**
 * Get decimal places for a token (with fallback).
 */
function getTokenDecimals(tokenAddress: string): number {
  try {
    return getOracleDecimals(tokenAddress);
  } catch {
    return TOKEN_DECIMALS[tokenAddress.toLowerCase()] ?? 18;
  }
}

/**
 * Get token price from cache (temporary solution until full async integration).
 * In production, this should be updated periodically by the price oracle.
 */
const priceCache = new Map<string, { price: number; timestamp: number }>();

function getTokenPrice(tokenAddress: string): number {
  const cached = priceCache.get(tokenAddress.toLowerCase());
  if (cached && Date.now() - cached.timestamp < 60000) { // 1 minute cache
    return cached.price;
  }
  
  // Fallback prices (will be updated by oracle)
  const fallbackPrices: Record<string, number> = {
    '0x4200000000000000000000000000000000000006': 2500.0, // WETH
    '0x0b2c639c533813f4aa9d7837caf62653d097ff85': 1.0,    // USDC
    '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58': 1.0,    // USDT
    '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 1.0,    // DAI
    '0x4200000000000000000000000000000000000042': 1.8,    // OP
    '0x68f180fcce6836688e9084f035309e29bf0a2095': 42000.0, // WBTC
  };
  
  return fallbackPrices[tokenAddress.toLowerCase()] ?? 1.0;
}

/**
 * Update price cache with fresh prices from oracle.
 * Called periodically by the monitor.
 */
export function updatePriceCache(tokenAddress: string, price: number): void {
  priceCache.set(tokenAddress.toLowerCase(), {
    price,
    timestamp: Date.now(),
  });
}

/**
 * Convert an amount to its USD value using cached prices.
 */
function convertToUsd(amount: bigint, tokenAddress: string): number {
  const decimals = getTokenDecimals(tokenAddress);
  const price = getTokenPrice(tokenAddress);
  
  const tokenAmount = Number(amount) / Math.pow(10, decimals);
  return tokenAmount * price;
}

/**
 * A single step in the execution plan (e.g., a contract call).
 */
export interface PlanStep {
  // Type of step (e.g., 'swap', 'transfer', 'flashloan')
  type: string;

  // Target contract address
  target: string;

  // Encoded function call data
  data: string;

  // Value to send (in wei)
  value?: bigint;

  // Human-readable description
  description: string;
}

/**
 * Executable plan to settle a pair of intents.
 */
export interface Plan {
  // Unique plan ID
  id: string;

  // Intents this plan settles
  intentA: Intent;
  intentB: Intent;

  // Array of steps to execute atomically
  steps: PlanStep[];

  // Expected output amounts (after execution)
  expectedOutputs: {
    amountForA: bigint; // Amount intentA will receive
    amountForB: bigint; // Amount intentB will receive
  };

  // Expected gas usage (wei)
  estimatedGas: bigint;

  // Expected profit (in quote token, wei)
  expectedProfit: bigint;

  // Creation timestamp
  createdAt: number;
}

/**
 * Build an execution plan from a candidate pair.
 * 
 * This is a simplified planner that assumes:
 * - Direct 1:1 swap through a single AMM
 * - No flashloans or multi-step routing
 * - Direct settlement contract call
 * 
 * TODO: Expand to support:
 * - Multiple intermediate swaps
 * - Flashloan routing
 * - Path optimization across multiple DEXs
 * - Dynamic pricing and slippage
 * 
 * @param candidate Matched pair of intents
 * @param ammAddress Address of the AMM contract
 * @param settlementAddress Address of the settlement contract
 * @returns Executable plan
 */
export function buildPlan(
  candidate: Candidate,
  ammAddress: string,
  settlementAddress: string
): Plan {
  const { intentA, intentB } = candidate;
  const planId = `plan_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  logger.info(`Building plan: ${planId} for intents ${intentA.id} <-> ${intentB.id}`);

  // TODO: Implement actual plan building
  // Current implementation is a placeholder with mock values

  // Step 1: (Placeholder) Approve settlement contract to spend sellTokens
  const steps: PlanStep[] = [
    {
      type: 'approve',
      target: intentA.sellToken,
      data: '0x095ea7b3', // approve selector (placeholder)
      description: `Approve settlement contract to spend ${intentA.sellAmount} of ${intentA.sellToken}`,
    },
    {
      type: 'approve',
      target: intentB.sellToken,
      data: '0x095ea7b3', // approve selector (placeholder)
      description: `Approve settlement contract to spend ${intentB.sellAmount} of ${intentB.sellToken}`,
    },
    {
      type: 'settle',
      target: settlementAddress,
      data: '0x12345678', // settle selector (placeholder)
      description: 'Execute atomic settlement of both intents',
    },
  ];

  // Calculate realistic output amounts based on intent minimums
  // IntentA: sells intentA.sellAmount of sellToken, wants at least intentA.minBuyAmount of buyToken
  // IntentB: sells intentB.sellAmount of buyToken, wants at least intentB.minBuyAmount of sellToken
  // In a matched pair:
  // - A gives sellAmount (receives minBuyAmount or more)
  // - B gives sellAmount (receives minBuyAmount or more)
  const expectedOutputs = {
    amountForA: intentB.sellAmount, // A receives what B sells
    amountForB: intentA.sellAmount, // B receives what A sells
  };

  // REALISTIC PROFIT CALCULATION using USD prices
  // This prevents the bug where 1e18 wei of different tokens were incorrectly compared
  
  // Calculate surplus amounts (in their native tokens)
  const surplusAmountA = expectedOutputs.amountForA > intentA.minBuyAmount 
    ? expectedOutputs.amountForA - intentA.minBuyAmount 
    : 0n;
  const surplusAmountB = expectedOutputs.amountForB > intentB.minBuyAmount 
    ? expectedOutputs.amountForB - intentB.minBuyAmount 
    : 0n;

  // Convert both surpluses to USD for realistic comparison
  const surplusUsdA = convertToUsd(surplusAmountA, intentA.buyToken);
  const surplusUsdB = convertToUsd(surplusAmountB, intentB.buyToken);

  // CORRECT PROFIT CALCULATION:
  // The profit from matching two intents is the minimum of the two USD surpluses.
  // This represents how much value (in USD) can be extracted from the transaction.
  // 
  // Example:
  // - IntentA gets 1.1 WETH but only wanted 1.0 WETH => surplus = 0.1 WETH = $250
  // - IntentB gets 1100 USDC but only wanted 1000 USDC => surplus = 100 USDC = $100
  // - Real profit = min($250, $100) = $100
  // 
  // This profit is then converted back to wei for calculation purposes.
  const profitUsd = Math.min(surplusUsdA, surplusUsdB);
  
  // For logging/calculation, quote profit in ETH (standard for Optimism)
  const ethPrice = getTokenPrice('0x4200000000000000000000000000000000000006');
  const profitInEthUnits = (profitUsd / ethPrice) * 1e18; // Convert USD to ETH wei
  let profitBeforeGas = BigInt(Math.floor(profitInEthUnits));
  
  // If surplus is very small, set minimum
  if (profitBeforeGas < 1000000n) {
    profitBeforeGas = 1000000n; // 0.000001 in 18-decimal token
  }

  // Estimate gas: ~200k for typical settlement (approve + settle)
  const estimatedGas = 200000n;

  // We'll calculate gas cost in the simulator when we have gasPrice
  // For now, estimate assuming 50 gwei gas price (0.05 ETH per transaction)
  // 200000 * 50e9 = 10e15 wei (0.01 ETH)
  const estimatedGasCost = estimatedGas * 50000000000n; // 50 gwei

  // Calculate expected profit: (surplus) - gas cost
  const expectedProfit = profitBeforeGas > estimatedGasCost 
    ? profitBeforeGas - estimatedGasCost 
    : 0n;

  return {
    id: planId,
    intentA,
    intentB,
    steps,
    expectedOutputs,
    estimatedGas,
    expectedProfit,
    createdAt: Math.floor(Date.now() / 1000),
  };
}

/**
 * Validate a plan for correctness before execution.
 * 
 * TODO: Add comprehensive validation:
 * - Check all steps have valid targets
 * - Verify step ordering
 * - Check for circular dependencies
 * - Validate expected outputs vs intent requirements
 */
export function validatePlan(plan: Plan): boolean {
  if (!plan.id || plan.steps.length === 0) {
    logger.error('Invalid plan: missing id or steps');
    return false;
  }

  // Basic check: ensure amounts satisfy intent minimums
  if (plan.expectedOutputs.amountForA < plan.intentA.minBuyAmount) {
    logger.warn(`Plan violates intentA min buy amount`);
    return false;
  }

  if (plan.expectedOutputs.amountForB < plan.intentB.minBuyAmount) {
    logger.warn(`Plan violates intentB min buy amount`);
    return false;
  }

  logger.debug(`Plan ${plan.id} is valid`);
  return true;
}
