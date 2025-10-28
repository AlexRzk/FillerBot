/**
 * src/eth/provider.ts
 * PURPOSE: Provide ethers.js provider and signer instances based on configuration.
 * Handles both local test node and live network scenarios.
 * 
 * SAFETY: Uses config.mode to determine endpoint. Local mode is safe (no real broadcasts).
 * Live mode requires explicit ENABLE_LIVE=true and valid credentials.
 * 
 * TODO: Add multi-RPC fallback logic with retry and rate-limiting
 * TODO: Add request batching for improved performance
 * TODO: Add gas price oracle integration for mainnet
 */

import { ethers } from 'ethers';
import { config } from '../config';
import logger from '../logger';

let provider: ethers.Provider | null = null;
let signer: ethers.Signer | null = null;

/**
 * Get or initialize the ethers provider.
 * In local mode, connects to http://127.0.0.1:8545 or configured RPC_URL.
 * In live mode, uses RPC_URL from config (must be set and ENABLE_LIVE=true).
 */
export function getProvider(): ethers.Provider {
  if (provider) return provider;

  const rpcUrl = config.rpcUrl;
  logger.info(`Initializing provider for ${config.mode} mode with RPC: ${rpcUrl}`);

  try {
    provider = new ethers.JsonRpcProvider(rpcUrl, config.chainId);
    logger.info('Provider initialized successfully');
  } catch (error) {
    logger.error(`Failed to initialize provider: ${error}`);
    throw error;
  }

  return provider;
}

/**
 * Get or initialize the ethers signer.
 * Signer is used for transaction signing and submission.
 * Only used in local mode or when ENABLE_LIVE=true.
 * 
 * TODO: Support hardware wallets, Ledger, Trezor (see @ledgerhq/ethers5-hw-app-eth)
 * TODO: Add KMS integration for production (AWS KMS, HashiCorp Vault)
 */
export function getSigner(): ethers.Signer {
  if (signer) return signer;

  const provider = getProvider();
  const privateKey = config.privateKey;

  if (!privateKey.startsWith('0x')) {
    throw new Error('PRIVATE_KEY must start with 0x');
  }

  try {
    signer = new ethers.Wallet(privateKey, provider);
    logger.info(`Signer initialized for address: ${signer.getAddress()}`);
  } catch (error) {
    logger.error(`Failed to initialize signer: ${error}`);
    throw error;
  }

  return signer;
}

/**
 * Call a contract function statically (read-only, no state changes).
 * Used for simulation before submitting transactions.
 * 
 * Example:
 * const amm = new ethers.Contract(ammAddress, AmmABI, provider);
 * const result = await callStatic(amm.swap(tokenIn, amountIn));
 */
export async function callStatic<T>(
  contractCall: Promise<T>
): Promise<T> {
  try {
    const result = await contractCall;
    return result;
  } catch (error) {
    logger.error(`callStatic failed: ${error}`);
    throw error;
  }
}

/**
 * Estimate gas for a transaction.
 * Used during planning and simulation phases.
 * 
 * TODO: Add multiplier configuration for safety margin
 * TODO: Implement dynamic gas estimation with priority fee logic
 */
export async function estimateGasForCall(
  to: string,
  data: string,
  from?: string
): Promise<bigint> {
  const provider = getProvider();

  try {
    const signerAddr = from || (await getSigner().getAddress());
    const gas = await provider.estimateGas({
      to,
      data,
      from: signerAddr,
    });

    logger.debug(`Estimated gas: ${gas.toString()}`);
    return gas;
  } catch (error) {
    logger.error(`Gas estimation failed: ${error}`);
    throw error;
  }
}

/**
 * Fetch the current gas price (base fee).
 * In local mode, typically returns nominal value.
 * 
 * TODO: Add EIP-1559 maxFeePerGas / maxPriorityFeePerGas logic
 */
export async function getGasPrice(): Promise<bigint> {
  const provider = getProvider();

  try {
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || BigInt(0);
    logger.debug(`Current gas price: ${gasPrice.toString()}`);
    return gasPrice;
  } catch (error) {
    logger.error(`Failed to fetch gas price: ${error}`);
    throw error;
  }
}

/**
 * Get the current block number.
 * Useful for deadline calculations and event filtering.
 */
export async function getCurrentBlockNumber(): Promise<number> {
  const provider = getProvider();

  try {
    const blockNumber = await provider.getBlockNumber();
    return blockNumber;
  } catch (error) {
    logger.error(`Failed to fetch block number: ${error}`);
    throw error;
  }
}

/**
 * Wait for a transaction to be confirmed.
 * Polls until receipt is available (or timeout).
 * 
 * TODO: Add configurable timeout and confirmations
 */
export async function waitForTxReceipt(
  txHash: string,
  confirmations: number = 1
): Promise<ethers.TransactionReceipt | null> {
  const provider = getProvider();

  try {
    logger.info(`Waiting for transaction: ${txHash}`);
    const receipt = await provider.waitForTransaction(txHash, confirmations);
    logger.info(`Transaction confirmed: ${txHash}`);
    return receipt;
  } catch (error) {
    logger.error(`Error waiting for transaction: ${error}`);
    throw error;
  }
}
