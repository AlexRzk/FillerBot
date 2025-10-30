/**
 * src/planner/planner.ts
 * MODIFIED
 * PURPOSE: Convert an intent into an executable plan
 * by getting a REAL quote from the aggregator.
 */

import { Intent } from '../models/intent';
import logger from '../logger';
import { aggregator } from '../aggregator';
import { ethers } from 'ethers';

// The Plan is now just a wrapper for the Aggregator's quote
export interface Plan {
  id: string;
  intent: Intent;
  // The full quote from the aggregator
  quote: any; // AggregatorQuote type
  // The expected profit in the *output token* (wei)
  expectedProfit: bigint;
  createdAt: number;
}
const priceCache = new Map<string, { price: number; timestamp: number }>();

export function updatePriceCache(tokenAddress: string, price: number): void {
  priceCache.set(tokenAddress.toLowerCase(), {
    price,
    timestamp: Date.now(),
  });
}

/**
 * Builds an execution plan by getting a real-time quote.
 *
 * @param intent The single intent to fill.
 * @returns A promise that resolves to a Plan.
 */
export async function buildPlan(intent: Intent): Promise<Plan> {
  const planId = `plan_${intent.id}_${Date.now()}`;
  logger.debug(`[planner] Building plan: ${planId} for intent ${intent.id}`);

  // 1. Get the on-chain quote from the aggregator
  // This is the new "brain"
  const quote = await aggregator.getQuote(intent);

  // 2. Calculate REAL expected profit (in output token wei)
  // This is the *only* profit calculation that matters.
  const expectedProfit = quote.amountOut - intent.minBuyAmount;

  // We already checked this in the aggregator, but we check again.
  if (expectedProfit <= 0n) {
    throw new Error(`Plan ${planId} is not profitable. 
      Quote: ${quote.amountOut}, User Min: ${intent.minBuyAmount}`);
  }

  logger.info(`[planner] Plan ${planId} built. 
    Expected Profit: ${ethers.formatUnits(expectedProfit, 18)} (output token)`);

  return {
    id: planId,
    intent,
    quote,
    expectedProfit,
    createdAt: Math.floor(Date.now() / 1000),
  };
}
