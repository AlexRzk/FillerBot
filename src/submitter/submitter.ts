/**
 * src/submitter/submitter.ts
 * PURPOSE: Submit the aggregator's transaction to the blockchain.
 * In LIVE mode, this is WRAPPED in a Flashbots bundle for MEV protection.
 */

import { ethers } from 'ethers';
import { Plan } from '../planner/planner';
import { config } from '../config';
import { getProvider, getSigner } from '../eth/provider';
import { submitBundleToFlashbots, simulateBundleOnFlashbots } from '../eth/flashbots';
import logger from '../logger';
import { SimulationResult } from '../simulator/simulator';

export interface SubmissionResult {
  success: boolean;
  txHash?: string;
  receipt?: ethers.TransactionReceipt | null;
  bundleHash?: string; // For Flashbots bundles
  error?: string;
}

/**
 * Submits the plan to the blockchain.
 * Routes to Flashbots if in 'live' mode.
 *
 * @param plan The plan to execute.
 * @param simulation The gas simulation result.
 * @returns A promise with the submission result.
 */
export async function submitPlan(
  plan: Plan,
  simulation: SimulationResult
): Promise<SubmissionResult> {
  logger.info(`[submitter] Submitting plan: ${plan.id}`);

  if (config.MODE === 'live') {
    if (!config.ENABLE_LIVE) {
      logger.error('FATAL: Attempted live submission without ENABLE_LIVE=true');
      return { success: false, error: 'Live submission disabled.' };
    }
    return await submitBundleWithFlashbots(plan, simulation);
  } else {
    // Use normal submission for local testing
    return await submitStandardTransaction(plan, simulation);
  }
}

/**
 * Submits a standard transaction (for LOCAL testing).
 */
async function submitStandardTransaction(
  plan: Plan,
  simulation: SimulationResult
): Promise<SubmissionResult> {
  logger.warn(`[submitter] Using STANDARD submission (local mode)`);
  const signer = getSigner();
  const provider = getProvider();

  try {
    const { quote } = plan;
    const feeData = await provider.getFeeData();

    const txOptions = {
      to: quote.txTo,
      data: quote.txData,
      gasLimit: simulation.gasEstimate,
      maxFeePerGas: feeData.maxFeePerGas || undefined,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || undefined,
    };

    const tx = await signer.sendTransaction(txOptions);
    logger.info(`[submitter] ✅ (local) Transaction sent: ${tx.hash}`);
    const receipt = await tx.wait(1);

    if (receipt) {
      logger.info(`[submitter] ✅ (local) Transaction confirmed in block ${receipt.blockNumber}`);
      return { success: true, txHash: tx.hash, receipt };
    } else {
      return { success: false, error: 'Transaction failed - receipt is null' };
    }
  } catch (error: any) {
    logger.error(`[submitter] (local) Submission failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Submits the transaction as a private Flashbots bundle (for LIVE mode).
 * 
 * How it works:
 * 1. Sign the swap transaction with our signer
 * 2. Optional: Simulate the bundle on Flashbots first
 * 3. Submit to Flashbots with authentication signature
 * 4. Flashbots broadcasts to block builders (private - no mempool exposure)
 * 5. Returns bundle hash to track inclusion status
 */
async function submitBundleWithFlashbots(
  plan: Plan,
  simulation: SimulationResult
): Promise<SubmissionResult> {
  logger.info(`[submitter] Using FLASHBOTS submission (live mode)`);

  if (!config.FLASHBOTS_AUTH_KEY) {
    logger.error('[submitter] FLASHBOTS_AUTH_KEY not configured');
    return { success: false, error: 'Flashbots auth key missing' };
  }

  try {
    const signer = getSigner();
    const provider = getProvider();
    const { quote } = plan;

    // Get current block for bundle target
    const currentBlock = await provider.getBlockNumber();
    const targetBlock = currentBlock + 1; // Target next block

    logger.info(`[submitter] Current block: ${currentBlock}, targeting block ${targetBlock}`);

    // Get gas pricing for the transaction
    const feeData = await provider.getFeeData();

    // Build the transaction
    const tx = {
      to: quote.txTo,
      from: await signer.getAddress(),
      data: quote.txData,
      gasLimit: simulation.gasEstimate,
      maxFeePerGas: feeData.maxFeePerGas || BigInt(1),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || BigInt(1),
    };

    // Sign the transaction
    logger.debug('[submitter] Signing transaction for Flashbots...');
    const signedTx = await signer.signTransaction(tx);

    // Optional: Simulate the bundle before submitting (recommended)
    logger.debug('[submitter] Simulating bundle on Flashbots...');
    const simulationResult = await simulateBundleOnFlashbots(
      [signedTx],
      targetBlock,
      config.FLASHBOTS_AUTH_KEY
    );

    if (!simulationResult) {
      logger.warn('[submitter] Bundle simulation failed, attempting submission anyway');
    } else if (simulationResult.revertingTxHashes?.length > 0) {
      logger.error('[submitter] Bundle would revert - aborting submission');
      return { success: false, error: 'Bundle simulation shows revert' };
    } else {
      logger.info(`[submitter] ✅ Simulation passed: ${simulationResult.totalGasUsed} gas`);
    }

    // Submit the bundle to Flashbots
    logger.info('[submitter] Submitting bundle to Flashbots Relay...');
    const bundleResponse = await submitBundleToFlashbots(
      [signedTx],
      targetBlock,
      config.FLASHBOTS_AUTH_KEY
    );

    logger.info(`[submitter] ✅ Bundle submitted: ${bundleResponse.bundleHash}`);
    return {
      success: true,
      bundleHash: bundleResponse.bundleHash,
      txHash: undefined, // Bundle hash, not tx hash - will be revealed when included
    };
  } catch (error: any) {
    logger.error(`[submitter] Flashbots submission failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

