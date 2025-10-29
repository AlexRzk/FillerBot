/**
 * src/submitter/submitter.ts
 * PURPOSE: Submit executed plans to the blockchain.
 * Handles local test mode and live network submission (gated by ENABLE_LIVE).
 * 
 * SAFETY CRITICAL:
 * - Local mode: Safe, sends to local test node
 * - Live mode: Requires ENABLE_LIVE=true and valid RPC credentials
 * - Real network submission is gated behind explicit config checks
 * 
 * TODO: Add retry logic with exponential backoff
 * TODO: Add mempool monitoring and replacement transaction logic
 * TODO: Add MEV protection (Flashbots, MEV-Blocker)
 * TODO: Add price feed oracle integration for live settlement
 */

import { ethers } from 'ethers';
import { Plan } from '../planner/planner';
import { config } from '../config';
import { formatAmount } from '../utils/eth';
import { getProvider, getSigner } from '../eth/provider';
import logger from '../logger';
import {
  createSettlementContract,
  executeOrder,
  estimateExecuteGas,
  PriorityOrder,
  validateOrder,
} from '../contracts/settlementContract';

/**
 * Result of plan submission.
 */
export interface SubmissionResult {
  // Did submission succeed?
  success: boolean;

  // Transaction hash (if sent)
  txHash?: string;

  // Transaction receipt (if confirmed)
  receipt?: ethers.TransactionReceipt | null;

  // Error details (if failed)
  error?: string;
}

/**
 * Submit a plan to the blockchain.
 * 
 * In local mode: Sends to local test node (safe).
 * In live mode: Requires ENABLE_LIVE=true (must be explicitly set).
 * 
 * IMPLEMENTATION: Constructs and submits actual settlement transactions.
 * 
 * @param plan Plan to submit
 * @param settlementAddress Address of settlement contract
 * @returns Submission result
 */
export async function submitPlan(
  plan: Plan,
  settlementAddress: string
): Promise<SubmissionResult> {
  logger.info(`Submitting plan: ${plan.id}`);

  // Verify mode is allowed
  if (config.mode === 'live' && !config.enableLive) {
    logger.error('FATAL: Attempted live submission without ENABLE_LIVE=true');
    return {
      success: false,
      error: 'Live submission disabled. Set ENABLE_LIVE=true to enable.',
    };
  }

  try {
    const profitInEth = formatAmount(plan.expectedProfit, 18);

    logger.info(
      `[${config.mode.toUpperCase()} MODE] Submitting settlement tx for intents: ${plan.intentA.id} <-> ${plan.intentB.id}`
    );
    logger.info(`Settlement contract: ${settlementAddress}`);
    logger.info(`Estimated gas: ${plan.estimatedGas} units`);
    logger.info(`Expected profit: ${profitInEth} ETH`);

    if (config.mode === 'local') {
      // In local mode, send to test node
      logger.info('Submitting to local test node...');

      try {
        const provider = getProvider();
        const signer = getSigner();
        
        // Create settlement contract instance
        const settlement = createSettlementContract(settlementAddress, signer);

        // Build Priority Order from plan.intentA
        const order: PriorityOrder = {
          info: ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
            ['bytes32'],
            [plan.intentA.id]
          )),
          inputToken: plan.intentA.sellToken,
          outputToken: plan.intentA.buyToken,
          inputAmount: plan.intentA.sellAmount,
          minOutputAmount: plan.intentA.minBuyAmount,
          swapper: plan.intentA.maker,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 300), // 5 min deadline
          fee: BigInt(0),
        };

        // Validate order
        const validation = validateOrder(order);
        if (!validation.valid) {
          logger.error(`Order validation failed: ${validation.error}`);
          return {
            success: false,
            error: `Order validation failed: ${validation.error}`,
          };
        }

        // Estimate gas
        const gasLimit = await estimateExecuteGas(
          settlement,
          order,
          '0x',  // Empty signature for now
          await signer.getAddress()
        );

        // Get current gas price
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || ethers.toBigInt('1000000000');  // Default 1 gwei
        const gasCostWei = gasLimit * gasPrice;
        const gasCostEth = formatAmount(gasCostWei, 18);

        logger.info(`Gas limit: ${gasLimit} units`);
        logger.info(`Gas price: ${formatAmount(gasPrice, 9)} gwei`);
        logger.info(`Gas cost: ~${gasCostEth} ETH`);

        // Send transaction
        const tx = await executeOrder(
          settlement,
          order,
          '0x',  // Placeholder signature
          {
            gasLimit,
            gasPrice,
          }
        );

        if (!tx) {
          logger.error('executeOrder returned null');
          return {
            success: false,
            error: 'Failed to create transaction',
          };
        }

        logger.info(`✅ Transaction sent: ${tx.hash}`);

        // Wait for confirmation
        const receipt = await tx.wait(1);
        
        if (receipt) {
          logger.info(`✅ Transaction confirmed in block ${receipt.blockNumber}`);
          logger.info(`Transaction hash: ${receipt.hash}`);
          logger.info(`Gas used: ${receipt.gasUsed}`);
          
          const gasSpentWei = receipt.gasUsed * gasPrice;
          const actualProfit = plan.expectedProfit - gasSpentWei;
          const actualProfitEth = formatAmount(actualProfit, 18);
          
          logger.info(`💰 Actual profit after gas: ${actualProfitEth} ETH`);

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
        logger.error(`Local submission error: ${error.message}`);
        return {
          success: false,
          error: `Submission failed: ${error.message}`,
        };
      }
    } else {
      // LIVE MODE - requires explicit ENABLE_LIVE=true
      if (!config.enableLive) {
        return {
          success: false,
          error: 'Live submission is disabled. Set ENABLE_LIVE=true to enable.',
        };
      }

      logger.warn('🚨 SUBMITTING TO LIVE NETWORK - ENSURE YOU UNDERSTAND THE RISKS');

      try {
        const provider = getProvider();
        const signer = getSigner();

        // Create settlement contract instance
        const settlement = createSettlementContract(settlementAddress, signer);

        // Build Priority Order from plan.intentA
        const order: PriorityOrder = {
          info: ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
            ['bytes32'],
            [plan.intentA.id]
          )),
          inputToken: plan.intentA.sellToken,
          outputToken: plan.intentA.buyToken,
          inputAmount: plan.intentA.sellAmount,
          minOutputAmount: plan.intentA.minBuyAmount,
          swapper: plan.intentA.maker,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
          fee: BigInt(0),
        };

        // Validate order
        const validation = validateOrder(order);
        if (!validation.valid) {
          logger.error(`Order validation failed: ${validation.error}`);
          return {
            success: false,
            error: `Order validation failed: ${validation.error}`,
          };
        }

        // Estimate gas
        const gasLimit = await estimateExecuteGas(
          settlement,
          order,
          '0x',
          await signer.getAddress()
        );

        // Get current gas price (with priority for live)
        const feeData = await provider.getFeeData();
        const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || BigInt(1000000000); // 1 gwei
        const maxFeePerGas = feeData.maxFeePerGas || BigInt(50000000000); // 50 gwei

        logger.info(`Max fee per gas: ${formatAmount(maxFeePerGas, 9)} gwei`);
        logger.info(`Max priority fee: ${formatAmount(maxPriorityFeePerGas, 9)} gwei`);

        // Send transaction with EIP-1559
        const tx = await executeOrder(
          settlement,
          order,
          '0x',
          {
            gasLimit,
            maxFeePerGas,
            maxPriorityFeePerGas,
          }
        );

        if (!tx) {
          logger.error('executeOrder returned null');
          return {
            success: false,
            error: 'Failed to create live transaction',
          };
        }

        logger.info(`✅ Live transaction sent: ${tx.hash}`);

        // Wait for confirmation (more confirmations for live)
        const receipt = await tx.wait(2);

        if (receipt) {
          logger.info(`✅ Transaction confirmed in block ${receipt.blockNumber}`);
          logger.info(`Gas used: ${receipt.gasUsed}`);

          const gasSpentWei = receipt.gasUsed * (feeData.gasPrice || BigInt(0));
          const actualProfit = plan.expectedProfit - gasSpentWei;
          const actualProfitEth = formatAmount(actualProfit, 18);

          logger.info(`💰 Actual profit: ${actualProfitEth} ETH`);

          return {
            success: true,
            txHash: tx.hash,
            receipt,
          };
        } else {
          logger.error('Live transaction failed - receipt is null');
          return {
            success: false,
            error: 'Live transaction confirmation failed',
            txHash: tx.hash,
          };
        }
      } catch (error: any) {
        logger.error(`Live submission error: ${error.message}`);
        logger.error('Stack:', error.stack);
        return {
          success: false,
          error: `Live submission failed: ${error.message}`,
        };
      }
    }
  } catch (error) {
    logger.error(`Plan submission failed: ${error}`);

    return {
      success: false,
      error: String(error),
    };
  }
}

/**
 * Submit to Flashbots for MEV protection (live mode only).
 * 
 * COMMENTED EXAMPLE - implement when ready:
 * 
 * TODO: Implement Flashbots integration
 * Example pseudocode:
 * ```
 * import { Flashbots } from '@flashbots/ethers-provider-bundle';
 *
 * const flashbotsProvider = await Flashbots.getDefaultProvider(provider, {
 *   flashbotsUrl: 'https://relay.flashbots.net',
 * });
 *
 * const signedBundle = await flashbotsProvider.sendPrivateTransaction({
 *   transaction: tx,
 *   options: {
 *     maxBlockNumber: await provider.getBlockNumber() + 200,
 *   },
 * });
 * ```
 */

/**
 * Submit to CoW Protocol for intent fulfillment (live mode only).
 * 
 * COMMENTED EXAMPLE - implement when ready:
 * 
 * TODO: Implement CoW Protocol integration
 * Example pseudocode:
 * ```
 * const cowOrderMetadata = {
 *   appCode: 'intent-solver',
 *   orderClass: 'market',
 *   orderType: 'buy',
 * };
 *
 * const response = await fetch('https://api.cow.fi/mainnet/orders', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     sellToken: plan.intentA.sellToken,
 *     buyToken: plan.intentA.buyToken,
 *     sellAmount: plan.intentA.sellAmount,
 *     buyAmount: plan.intentA.minBuyAmount,
 *     kind: 'sell',
 *     receiver: plan.intentA.maker,
 *     ...cowOrderMetadata,
 *   }),
 * });
 * ```
 */
