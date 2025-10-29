/**
 * src/eth/flashbots.ts
 * PURPOSE: Interact with the Flashbots relay for MEV protection.
 */

import { ethers } from 'ethers';
import logger from '../logger';

export function createFlashbotsAuthSigner(): ethers.Wallet {
  const authKey = process.env.FLASHBOTS_AUTH_KEY;
  if (!authKey) {
    throw new Error('FLASHBOTS_AUTH_KEY environment variable is not set');
  }
  return new ethers.Wallet(authKey);
}

export async function sendBundle(
  signedTxs: string[],
  targetBlock: number,
  flashbotsRpcUrl: string
): Promise<any> {
  const authSigner = createFlashbotsAuthSigner();

  const params = [{
    txs: signedTxs,
    blockNumber: `0x${targetBlock.toString(16)}`,
  }];

  const signature = await authSigner.signMessage(ethers.id(JSON.stringify(params)));
  const request = {
    method: 'eth_sendBundle',
    params,
    id: 1,
    jsonrpc: '2.0'
  };

  const headers = {
    'Content-Type': 'application/json',
    'X-Flashbots-Signature': `${await authSigner.getAddress()}:${signature}`
  };

  logger.info('Sending bundle to Flashbots');

  const res = await fetch(flashbotsRpcUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(request)
  });

  return await res.json();
}