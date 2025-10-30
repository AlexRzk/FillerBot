/**
 * src/eth/flashbots.ts
 * PURPOSE: Flashbots bundle submission for private MEV protection
 *
 * The Flashbots Relay protects your transactions from being seen by MEV bots
 * by submitting them as "bundles" - atomic groups of transactions.
 *
 * Key Concepts:
 * - Bundles are private until included in a block (no mempool exposure)
 * - Flashbots signs with X-Flashbots-Signature header (requires private key)
 * - Target block: blockNumber where you want your bundle included
 * - Timestamp bounds: Optional time constraints for bundle validity
 */

import { ethers } from 'ethers';
import { config } from '../config';
import logger from '../logger';

export interface FlashbotsBundle {
  txs: string[]; // Array of signed transaction serialized as hex (0x...)
  blockNumber: string; // Hex-encoded block number (e.g., "0x12c4bf0")
  minTimestamp?: number; // Optional: minimum timestamp for validity
  maxTimestamp?: number; // Optional: maximum timestamp for validity
  revertingTxHashes?: string[]; // Allowed-to-revert transaction hashes
}

export interface FlashbotsBundleResponse {
  bundleHash: string;
}

/**
 * Signs the request payload according to EIP-191
 * Used for Flashbots API authentication via X-Flashbots-Signature header
 *
 * Format: "0x{public_address}:0x{signature}"
 */
export function signFlashbotsPayload(
  payload: string,
  signerPrivateKey: string
): string {
  const wallet = new ethers.Wallet(signerPrivateKey);
  
  // EIP-191 hash of the payload (this is what Flashbots expects)
  const messageHash = ethers.hashMessage(payload);
  const signature = wallet.signingKey.sign(messageHash).serialized;

  // Format: "address:signature" (no 0x prefix on address in header)
  return `${wallet.address}:${signature}`;
}

/**
 * Submits a bundle to Flashbots Relay
 *
 * @param transactions Array of signed transactions (serialized as hex)
 * @param targetBlockNumber The block number where you want this bundle included
 * @param flashbotsPrivateKey Private key for signing (can be different from signer)
 * @returns The bundle hash from Flashbots
 */
export async function submitBundleToFlashbots(
  transactions: string[],
  targetBlockNumber: number,
  flashbotsPrivateKey: string
): Promise<FlashbotsBundleResponse> {
  const relayUrl = config.FLASHBOTS_RELAY_URL;
  const blockNumberHex = ethers.toBeHex(targetBlockNumber);

  const bundle: FlashbotsBundle = {
    txs: transactions,
    blockNumber: blockNumberHex,
  };

  // Create JSON-RPC payload
  const jsonRpcPayload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_sendBundle',
    params: [bundle],
  };

  const payloadString = JSON.stringify(jsonRpcPayload);

  // Sign the payload for authentication
  const signature = signFlashbotsPayload(payloadString, flashbotsPrivateKey);

  logger.info(`[flashbots] Submitting bundle to ${relayUrl}`);
  logger.debug(`[flashbots] Bundle: ${transactions.length} txs targeting block ${blockNumberHex}`);

  try {
    const response = await fetch(relayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Flashbots-Signature': signature,
      },
      body: payloadString,
    });

    const result = (await response.json()) as any;

    if (result.error) {
      logger.error(`[flashbots] Error: ${result.error.message}`);
      throw new Error(`Flashbots error: ${result.error.message}`);
    }

    const bundleHash = result.result?.bundleHash;
    if (!bundleHash) {
      throw new Error('No bundleHash in response');
    }

    logger.info(`[flashbots] ✅ Bundle submitted: ${bundleHash}`);
    return { bundleHash };
  } catch (error: any) {
    logger.error(`[flashbots] Submission failed: ${error.message}`);
    throw error;
  }
}

/**
 * Simulates a bundle before submitting it (optional but recommended)
 * Uses eth_callBundle to test the bundle without broadcasting
 *
 * @param transactions Array of signed transactions
 * @param blockNumber Block number to simulate against
 * @param flashbotsPrivateKey Private key for authentication
 * @returns Simulation results (gas used, outputs, etc.)
 */
export async function simulateBundleOnFlashbots(
  transactions: string[],
  blockNumber: number,
  flashbotsPrivateKey: string
): Promise<any> {
  const relayUrl = config.FLASHBOTS_RELAY_URL;
  const blockNumberHex = ethers.toBeHex(blockNumber);

  const bundle = {
    txs: transactions,
    blockNumber: blockNumberHex,
    stateBlockNumber: 'latest',
  };

  const jsonRpcPayload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_callBundle',
    params: [bundle],
  };

  const payloadString = JSON.stringify(jsonRpcPayload);
  const signature = signFlashbotsPayload(payloadString, flashbotsPrivateKey);

  logger.info(`[flashbots] Simulating bundle...`);

  try {
    const response = await fetch(relayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Flashbots-Signature': signature,
      },
      body: payloadString,
    });

    const result = (await response.json()) as any;

    if (result.error) {
      logger.error(`[flashbots] Simulation error: ${result.error.message}`);
      return null;
    }

    logger.info(`[flashbots] ✅ Simulation result: gasUsed=${result.result?.totalGasUsed}`);
    return result.result;
  } catch (error: any) {
    logger.error(`[flashbots] Simulation failed: ${error.message}`);
    return null;
  }
}

/**
 * Gets bundle stats from Flashbots
 * Shows whether your bundle was simulated, sent to builders, etc.
 *
 * @param bundleHash The bundle hash returned from eth_sendBundle
 * @param blockNumber The target block number (hex encoded)
 * @param flashbotsPrivateKey Private key for authentication
 * @returns Bundle status information
 */
export async function getBundleStats(
  bundleHash: string,
  blockNumber: number,
  flashbotsPrivateKey: string
): Promise<any> {
  const relayUrl = config.FLASHBOTS_RELAY_URL;
  const blockNumberHex = ethers.toBeHex(blockNumber);

  const jsonRpcPayload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'flashbots_getBundleStatsV2',
    params: [
      {
        bundleHash,
        blockNumber: blockNumberHex,
      },
    ],
  };

  const payloadString = JSON.stringify(jsonRpcPayload);
  const signature = signFlashbotsPayload(payloadString, flashbotsPrivateKey);

  try {
    const response = await fetch(relayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Flashbots-Signature': signature,
      },
      body: payloadString,
    });

    const result = (await response.json()) as any;
    return result.result;
  } catch (error: any) {
    logger.error(`[flashbots] Failed to get bundle stats: ${error.message}`);
    return null;
  }
}