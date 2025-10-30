/**
 * src/submitter/submitter.ts
 * PURPOSE: Submit executed plans to the blockchain.
 * REWRITTEN: To submit the aggregator's transaction data directly.
 */

import { ethers } from 'ethers';
import { Plan } from '../planner/planner';
import { SimulationResult } from '../simulator/simulator';
import { config } from '../config';
import { getProvider, getSigner } from '../eth/provider';
import { submitBundleToFlashbots } from '../eth/flashbots';
import logger from '../logger';

export interface SubmissionResult {
  success: boolean;
  txHash?: string;
  bundleHash?: string;
  receipt?: ethers.TransactionReceipt | null;
  error?: string;
}

/**
 * Submits a plan to the blockchain.
 * Routes to Flashbots if in live mode, otherwise uses standard submission.
 */
export async function submitPlan(plan: Plan, simResult: SimulationResult): Promise<SubmissionResult> {
  logger.info(`[submitter] Submitting plan: ${plan.id}`);

  if (config.MODE === 'live' && !config.ENABLE_LIVE) {
    logger.error('FATAL: Attempted live submission without ENABLE_LIVE=true');
    return { success: false, error: 'Live submission disabled' };
  }

  // Route to Flashbots if live mode with Flashbots configured
  if (config.MODE === 'live' && config.FLASHBOTS_RELAY_URL && config.FLASHBOTS_AUTH_KEY) {
    return await submitWithFlashbots(plan, simResult);
  } else {
    return await submitStandard(plan, simResult);
  }
}

/**
 * Standard submission for local/testnet mode.
 */
async function submitStandard(plan: Plan, simResult: SimulationResult): Promise<SubmissionResult> {
  logger.info(`[submitter] Using STANDARD submission`);
  const provider = getProvider();
  const signer = getSigner();

  try {
    const feeData = await provider.getFeeData();
    if (!feeData.maxFeePerGas || !feeData.maxPriorityFeePerGas) {
      throw new Error('Failed to get EIP-1559 fee data');
    }

    const txOptions: ethers.TransactionRequest = {
      to: plan.quote.txTo,
      data: plan.quote.txData,
      gasLimit: simResult.gasEstimate,
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      chainId: config.CHAIN_ID,
    };

    logger.info(`[submitter] Sending TX to ${txOptions.to}`);
    const tx = await signer.sendTransaction(txOptions);

    logger.info(`[submitter] ✅ TX sent: ${tx.hash}`);
    const receipt = await tx.wait(config.MODE === 'live' ? 2 : 1);

    if (receipt) {
      logger.info(`[submitter] ✅ TX confirmed in block ${receipt.blockNumber}`);
      return { success: true, txHash: tx.hash, receipt };
    } else {
      throw new Error('Receipt is null');
    }
  } catch (error: any) {
    logger.error(`[submitter] Submission failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Flashbots submission for live mode MEV protection.
 */
async function submitWithFlashbots(plan: Plan, simResult: SimulationResult): Promise<SubmissionResult> {
  logger.info(`[submitter] Using FLASHBOTS submission`);
  const provider = getProvider();
  const signer = getSigner();
  const fillerAddress = await signer.getAddress();

  try {
    // Get current block
    const currentBlock = await provider.getBlockNumber();
    const targetBlock = currentBlock + 1;

    // Get fee data
    const feeData = await provider.getFeeData();
    if (!feeData.maxFeePerGas || !feeData.maxPriorityFeePerGas) {
      throw new Error('Failed to get EIP-1559 fee data');
    }

    // Build transaction
    const tx = {
      to: plan.quote.txTo,
      from: fillerAddress,
      data: plan.quote.txData,
      gasLimit: simResult.gasEstimate,
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      chainId: config.CHAIN_ID,
    };

    // Sign transaction
    logger.debug('[submitter] Signing TX for Flashbots...');
    const signedTx = await signer.signTransaction(tx);

    // Submit to Flashbots
    logger.info('[submitter] Submitting bundle to Flashbots...');
    const bundleResponse = await submitBundleToFlashbots(
      [signedTx],
      targetBlock,
      config.FLASHBOTS_AUTH_KEY!
    );

    logger.info(`[submitter] ✅ Bundle submitted: ${bundleResponse.bundleHash}`);
    return { success: true, bundleHash: bundleResponse.bundleHash };
  } catch (error: any) {
    logger.error(`[submitter] Flashbots submission failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

