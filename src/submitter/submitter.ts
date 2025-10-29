
/**
 * src/submitter/submitter.ts
 * PURPOSE: Submit executed plans to the blockchain.
 */

import { ethers } from 'ethers';
import { Plan } from '../planner/planner';
import { config } from '../config';
import { formatAmount } from '../utils/eth';
import { getProvider, getSigner } from '../eth/provider';
import logger from '../logger';
import {
  createSettlementContract,
  estimateExecuteGas,
  PriorityOrder,
  validateOrder,
} from '../contracts/settlementContract';

export interface SubmissionResult {
  success: boolean;
  txHash?: string;
  receipt?: ethers.TransactionReceipt | null;
  error?: string;
}

async function retry<T>(fn: () => Promise<T>, retries: number, delay: number): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      logger.warn(`Attempt ${i + 1} failed. Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
  throw lastError;
}

export async function submitPlan(
  plan: Plan,
  settlementAddress: string
): Promise<SubmissionResult> {
  logger.info(`Submitting plan: ${plan.id}`);

  if (config.MODE === 'live' && !config.ENABLE_LIVE) {
    logger.error('FATAL: Attempted live submission without ENABLE_LIVE=true');
    return {
      success: false,
      error: 'Live submission disabled. Set ENABLE_LIVE=true to enable.',
    };
  }

  try {
    const profitInEth = formatAmount(plan.expectedProfit, 18);

    logger.info(
      `[${config.MODE.toUpperCase()} MODE] Submitting settlement tx for intents: ${plan.intentA.id} <-> ${plan.intentB.id}`
    );
    logger.info(`Settlement contract: ${settlementAddress}`);
    logger.info(`Estimated gas: ${plan.estimatedGas} units`);
    logger.info(`Expected profit: ${profitInEth} ETH`);

    const signature = plan.signatureA;
    if (!signature) {
      return {
        success: false,
        error: 'Signature not found in plan.',
      };
    }

    const provider = getProvider();
    const signer = getSigner();
    const settlement = createSettlementContract(settlementAddress, signer);

    const order: PriorityOrder = {
      info: ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32'], [plan.intentA.id])),
      inputToken: plan.intentA.sellToken,
      outputToken: plan.intentA.buyToken,
      inputAmount: plan.intentA.sellAmount,
      minOutputAmount: plan.intentA.minBuyAmount,
      swapper: plan.intentA.maker,
      deadline: BigInt(plan.intentA.deadline),
      fee: BigInt(0),
    };

    const validation = validateOrder(order);
    if (!validation.valid) {
      logger.error(`Order validation failed: ${validation.error}`);
      return {
        success: false,
        error: `Order validation failed: ${validation.error}`,
      };
    }

    const gasLimit = await estimateExecuteGas(
      settlement,
      order,
      signature,
      await signer.getAddress()
    );

    const feeData = await provider.getFeeData();
    const txOptions = {
      gasLimit,
      maxFeePerGas: feeData.maxFeePerGas || undefined,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || undefined,
      to: settlementAddress,
      data: settlement.interface.encodeFunctionData('execute', [order, signature]),
      chainId: config.CHAIN_ID,
    };

    const tx = await retry(() => signer.sendTransaction(txOptions), config.SUBMITTER_RETRY_COUNT, config.SUBMITTER_RETRY_DELAY_MS);
    logger.info(`✅ Transaction sent: ${tx.hash}`);
    const receipt = await tx.wait(config.MODE === 'live' ? 2 : 1);

    if (receipt) {
      logger.info(`✅ Transaction confirmed in block ${receipt.blockNumber}`);
      return {
        success: true,
        txHash: tx.hash,
        receipt,
      };
    } else {
      logger.error('Transaction failed - receipt is null');
      return {
        success: false,
        error: 'Transaction confirmation failed',
        txHash: tx.hash,
      };
    }
  } catch (error: any) {
    logger.error(`Plan submission failed: ${error.message}`);
    return {
      success: false,
      error: `Submission failed: ${error.message}`,
    };
  }
}
