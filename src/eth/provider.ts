/**
 * src/eth/provider.ts
 * PURPOSE: Provide ethers.js provider and signer instances based on configuration.
 */

import { ethers } from 'ethers';
import { config } from '../config';
import logger from '../logger';

let provider: ethers.Provider | null = null;
let signer: ethers.Signer | null = null;

const GAS_PRICE_ORACLE_ADDRESS = '0x420000000000000000000000000000000000000F';
const GAS_PRICE_ORACLE_ABI = [
  {
    "inputs": [
      {
        "internalType": "bytes",
        "name": "_data",
        "type": "bytes"
      }
    ],
    "name": "getL1Fee",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

export function getProvider(): ethers.Provider {
  if (provider) return provider;

  const rpcConfigs = config.RPC_URLS.map((url: string) => ({ provider: new ethers.JsonRpcProvider(url, config.CHAIN_ID) }));

  logger.info(`Initializing FallbackProvider for ${config.MODE} mode with ${rpcConfigs.length} RPCs.`);

  try {
    provider = new ethers.FallbackProvider(rpcConfigs);
    logger.info('Provider initialized successfully');
  } catch (error) {
    logger.error(`Failed to initialize provider: ${error}`);
    throw error;
  }

  return provider;
}

export function getSigner(): ethers.Signer {
  if (signer) return signer;

  const provider = getProvider();
  const privateKey = config.PRIVATE_KEY;

  if (!privateKey.startsWith('0x')) {
    throw new Error('PRIVATE_KEY must start with 0x');
  }

  try {
    signer = new ethers.Wallet(privateKey, provider);
  } catch (error) {
    logger.error(`Failed to initialize signer: ${error}`);
    throw error;
  }

  return signer;
}

export async function getGasPrice(): Promise<{ maxFeePerGas: bigint, maxPriorityFeePerGas: bigint }> {
  const provider = getProvider();

  try {
    const feeData = await provider.getFeeData();
    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
      return { 
        maxFeePerGas: feeData.maxFeePerGas, 
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas 
      };
    }
    // Fallback for non-EIP-1559 networks
    const gasPrice = feeData.gasPrice || BigInt(0);
    return { maxFeePerGas: gasPrice, maxPriorityFeePerGas: gasPrice };

  } catch (error) {
    logger.error(`Failed to fetch gas price: ${error}`);
    throw error;
  }
}

export async function getL1Fee(txData: string): Promise<bigint> {
  const provider = getProvider();
  const gasPriceOracle = new ethers.Contract(GAS_PRICE_ORACLE_ADDRESS, GAS_PRICE_ORACLE_ABI, provider);

  try {
    return await gasPriceOracle.getL1Fee(txData);
  } catch (error) {
    logger.error(`Failed to fetch L1 fee: ${error}`);
    throw error;
  }
}

export function startHealthChecks(provider: ethers.FallbackProvider, interval: number): () => void {
  const check = async () => {
    try {
      const blockNumber = await provider.getBlockNumber();
      logger.info(`Health check passed. Current block number: ${blockNumber}`);
    } catch (error) {
      logger.error(`Health check failed: ${error}`);
    }
  };

  const intervalId = setInterval(check, interval);

  return () => clearInterval(intervalId);
}