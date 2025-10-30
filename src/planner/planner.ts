/**
 * src/planner/planner.ts
 * PURPOSE: Convert a candidate pair into an executable plan.
 * Plan includes steps, expected outputs, and gas estimation.
 */

import { Intent } from '../models/intent';
import { Candidate } from '../matcher/matcher';
import logger from '../logger';
import { getTokenDecimals as getOracleDecimals } from '../utils/priceOracle';
import { getGasPrice, getL1Fee, getProvider } from '../eth/provider';
import { ethers } from 'ethers';
import { MockAMM__factory } from '../../typechain-types';

const TOKEN_DECIMALS: { [address: string]: number } = {
  '0x7f5c764cbc14f9669b88dc4c52a84e7cffbf05c0': 6,
  '0x0b2c639c533813f4aa9d7837caf62653d097ff85': 6,
  '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58': 6,
  '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 18,
  '0x4200000000000000000000000000000000000006': 18,
  '0x4200000000000000000000000000000000000042': 18,
  '0x68f180fcce6836688e9084f035309e29bf0a2095': 8,
};

function getTokenDecimals(tokenAddress: string): number {
  try {
    return getOracleDecimals(tokenAddress);
  } catch {
    return TOKEN_DECIMALS[tokenAddress.toLowerCase()] ?? 18;
  }
}

const priceCache = new Map<string, { price: number; timestamp: number }>();

function getTokenPrice(tokenAddress: string): number {
  const cached = priceCache.get(tokenAddress.toLowerCase());
  if (cached && Date.now() - cached.timestamp < 60000) {
    return cached.price;
  }
  
  const fallbackPrices: Record<string, number> = {
    '0x4200000000000000000000000000000000000006': 2500.0,
    '0x0b2c639c533813f4aa9d7837caf62653d097ff85': 1.0,
    '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58': 1.0,
    '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 1.0,
    '0x4200000000000000000000000000000000000042': 1.8,
    '0x68f180fcce6836688e9084f035309e29bf0a2095': 42000.0,
  };
  
  return fallbackPrices[tokenAddress.toLowerCase()] ?? 1.0;
}

export function updatePriceCache(tokenAddress: string, price: number): void {
  priceCache.set(tokenAddress.toLowerCase(), {
    price,
    timestamp: Date.now(),
  });
}

function convertToUsd(amount: bigint, tokenAddress: string): number {
  const decimals = getTokenDecimals(tokenAddress);
  const price = getTokenPrice(tokenAddress);
  
  const tokenAmount = Number(amount) / Math.pow(10, decimals);
  return tokenAmount * price;
}

export interface PlanStep {
  type: string;
  target: string;
  data: string;
  value?: bigint;
  description: string;
}

export interface Plan {
  id: string;
  intentA: Intent;
  intentB: Intent;
  steps: PlanStep[];
  expectedOutputs: {
    amountForA: bigint;
    amountForB: bigint;
  };
  estimatedGas: bigint;
  expectedProfit: bigint;
  createdAt: number;
  signatureA?: string;
  signatureB?: string;
}

export async function buildPlan(
  candidate: Candidate,
  settlementAddress: string,
  ammAddress: string,
): Promise<Plan> {
  const { intentA, intentB } = candidate;
  const planId = `plan_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  logger.info(`Building plan: ${planId} for intents ${intentA.id} <-> ${intentB.id}`);

  const provider = getProvider();
  const amm = MockAMM__factory.connect(ammAddress, provider);

  const settlementInterface = new ethers.Interface([
    'function settle(tuple(string id, address maker, address sellToken, address buyToken, uint256 sellAmount, uint256 minBuyAmount, uint256 deadline) intentA, tuple(string id, address maker, address sellToken, address buyToken, uint256 sellAmount, uint256 minBuyAmount, uint256 deadline) intentB)',
  ]);

  const calldata = settlementInterface.encodeFunctionData('settle', [intentA, intentB]);

  const steps: PlanStep[] = [
    {
      type: 'settle',
      target: settlementAddress,
      data: calldata,
      description: 'Execute atomic settlement of both intents',
    },
  ];

  const [reserveA, reserveB] = await amm.getReserves();

  const amountOutA = await amm.getAmountOut(intentA.sellToken, intentA.sellAmount, reserveA, reserveB);
  const amountOutB = await amm.getAmountOut(intentB.sellToken, intentB.sellAmount, reserveB, reserveA);

  const expectedOutputs = {
    amountForA: amountOutB,
    amountForB: amountOutA,
  };

  const surplusA = expectedOutputs.amountForA - intentA.minBuyAmount;
  const surplusB = expectedOutputs.amountForB - intentB.minBuyAmount;

  const surplusUsdA = convertToUsd(surplusA, intentA.buyToken);
  const surplusUsdB = convertToUsd(surplusB, intentB.buyToken);

  const profitUsd = Math.min(surplusUsdA, surplusUsdB);

  const ethPrice = getTokenPrice('0x4200000000000000000000000000000000000006');
  const profitInEthUnits = profitUsd / ethPrice;
  const profitBeforeGas = BigInt(Math.floor(profitInEthUnits * 1e18));

  const estimatedGas = await provider.estimateGas({
    to: settlementAddress,
    data: calldata,
  });

  const { maxFeePerGas } = await getGasPrice();
  const l1Fee = await getL1Fee(calldata);
  const estimatedGasCost = estimatedGas * maxFeePerGas + l1Fee;

  const expectedProfit = profitBeforeGas - estimatedGasCost;

  return {
    id: planId,
    intentA,
    intentB,
    steps,
    expectedOutputs,
    estimatedGas,
    expectedProfit,
    createdAt: Math.floor(Date.now() / 1000),
    signatureA: intentA.signature,
    signatureB: intentB.signature,
  };
}

export function validatePlan(plan: Plan): boolean {
  if (!plan.id || plan.steps.length === 0) {
    logger.error('Invalid plan: missing id or steps');
    return false;
  }

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