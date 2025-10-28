/**
 * src/utils/eth.ts
 * PURPOSE: Ethereum-specific utilities for contracts, addresses, and token operations.
 * 
 * TODO: Add ERC20 token fetching (name, symbol, decimals)
 * TODO: Add checksum address validation
 * TODO: Add contract interface detection
 */

import { ethers } from 'ethers';
import { getProvider } from '../eth/provider';
import logger from '../logger';

// Standard ERC20 ABI (minimal)
const ERC20_ABI = [
  'function balanceOf(address owner) public view returns (uint256)',
  'function decimals() public view returns (uint8)',
  'function symbol() public view returns (string)',
  'function name() public view returns (string)',
  'function approve(address spender, uint256 amount) public returns (bool)',
  'function transfer(address to, uint256 amount) public returns (bool)',
];

/**
 * Validate Ethereum address format.
 * Checks if string is a valid 42-character hex string starting with 0x.
 */
export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Convert address to checksummed format.
 * Ensures consistent address representation across the codebase.
 */
export function getChecksumAddress(address: string): string {
  try {
    return ethers.getAddress(address);
  } catch (error) {
    logger.warn(`Invalid address format: ${address}`);
    return address;
  }
}

/**
 * Fetch ERC20 token decimals.
 * Uses call (read-only) so no state change occurs.
 * 
 * TODO: Cache decimals locally to reduce RPC calls
 */
export async function getTokenDecimals(tokenAddress: string): Promise<number> {
  try {
    const provider = getProvider();
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const decimals = await contract.decimals();
    logger.debug(`Token ${tokenAddress} has ${decimals} decimals`);
    return decimals;
  } catch (error) {
    logger.error(`Failed to fetch token decimals: ${error}`);
    throw error;
  }
}

/**
 * Fetch ERC20 token symbol.
 * 
 * TODO: Cache symbols locally
 */
export async function getTokenSymbol(tokenAddress: string): Promise<string> {
  try {
    const provider = getProvider();
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const symbol = await contract.symbol();
    return symbol;
  } catch (error) {
    logger.warn(`Failed to fetch token symbol for ${tokenAddress}: ${error}`);
    return tokenAddress;
  }
}

/**
 * Fetch ERC20 token name.
 * 
 * TODO: Cache names locally
 */
export async function getTokenName(tokenAddress: string): Promise<string> {
  try {
    const provider = getProvider();
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const name = await contract.name();
    return name;
  } catch (error) {
    logger.warn(`Failed to fetch token name for ${tokenAddress}: ${error}`);
    return tokenAddress;
  }
}

/**
 * Fetch user's token balance.
 */
export async function getTokenBalance(tokenAddress: string, userAddress: string): Promise<bigint> {
  try {
    const provider = getProvider();
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const balance = await contract.balanceOf(userAddress);
    return balance;
  } catch (error) {
    logger.error(`Failed to fetch token balance: ${error}`);
    throw error;
  }
}

/**
 * Format amount with token decimals.
 * Converts wei to human-readable format.
 * 
 * Example: 1000000000000000000 with 18 decimals -> "1.0"
 */
export function formatAmount(amount: bigint, decimals: number): string {
  return ethers.formatUnits(amount, decimals);
}

/**
 * Parse human-readable amount to wei.
 * 
 * Example: "1.0" with 18 decimals -> 1000000000000000000n
 */
export function parseAmount(amount: string, decimals: number): bigint {
  return ethers.parseUnits(amount, decimals);
}

/**
 * Convert bytes32 to string (for event topic decoding).
 * 
 * TODO: Add keccak256 hashing for event signature encoding
 */
export function bytes32ToString(bytes32: string): string {
  return ethers.toUtf8String(bytes32).replace(/\0/g, '');
}

/**
 * Create contract interface from ABI JSON.
 * Useful for encoding/decoding contract calls.
 */
export function createContractInterface(abi: string[]): ethers.Interface {
  return new ethers.Interface(abi);
}
