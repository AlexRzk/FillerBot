/**
 * src/contracts/settlementContract.ts
 * PURPOSE: UniswapX Settlement Contract interface and utilities
 * 
 * This module provides:
 * - Contract ABI for UniswapX Priority Order Reactor
 * - Contract interaction utilities
 * - Type-safe function calls for settlement
 * - Gas estimation helpers
 */

import { ethers } from 'ethers';

/**
 * UniswapX Priority Order Reactor ABI on Base mainnet
 * Address: 0x000000001Ec5656dcdB24D90DFa42742738De729
 * 
 * This is a minimal ABI with the core functions needed for:
 * - Executing Priority Orders
 * - Executing Dutch Orders
 * - Checking order status
 */
export const SETTLEMENT_ABI = [
  // Execute a single order
  {
    name: 'execute',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        components: [
          { name: 'info', type: 'bytes32' },
          { name: 'inputToken', type: 'address' },
          { name: 'outputToken', type: 'address' },
          { name: 'inputAmount', type: 'uint256' },
          { name: 'minOutputAmount', type: 'uint256' },
          { name: 'swapper', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'fee', type: 'uint256' },
        ],
      },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },

  // Execute multiple orders (batch)
  {
    name: 'executeBatch',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'orders',
        type: 'tuple[]',
        components: [
          { name: 'info', type: 'bytes32' },
          { name: 'inputToken', type: 'address' },
          { name: 'outputToken', type: 'address' },
          { name: 'inputAmount', type: 'uint256' },
          { name: 'minOutputAmount', type: 'uint256' },
          { name: 'swapper', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'fee', type: 'uint256' },
        ],
      },
      { name: 'signatures', type: 'bytes[]' },
    ],
    outputs: [],
  },

  // Fill event - emitted when an order is executed
  {
    name: 'Fill',
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'orderHash', type: 'bytes32', indexed: true },
      { name: 'filler', type: 'address', indexed: true },
      { name: 'swapper', type: 'address', indexed: true },
      { name: 'nonce', type: 'uint256', indexed: false },
    ],
  },
];

/**
 * Contract addresses on different networks
 */
export const SETTLEMENT_ADDRESSES = {
  8453: '0x000000001Ec5656dcdB24D90DFa42742738De729',   // Base mainnet
  84532: '0x000000001Ec5656dcdB24D90DFa42742738De729',  // Base Sepolia (if deployed)
  31337: '0x0000000000000000000000000000000000000001',    // Local test
};

/**
 * Get settlement contract address for a chain
 */
export function getSettlementAddress(chainId: number): string {
  const address = SETTLEMENT_ADDRESSES[chainId as keyof typeof SETTLEMENT_ADDRESSES];
  if (!address) {
    throw new Error(`Settlement contract not deployed on chain ${chainId}`);
  }
  return address;
}

/**
 * Create a settlement contract instance
 */
export function createSettlementContract(
  address: string,
  signerOrProvider: ethers.Signer | ethers.Provider
): ethers.Contract {
  return new ethers.Contract(address, SETTLEMENT_ABI, signerOrProvider);
}

/**
 * Create interface for encoding/decoding settlement calls
 */
export function createSettlementInterface(): ethers.Interface {
  return new ethers.Interface(SETTLEMENT_ABI);
}

/**
 * Priority Order Struct
 */
export interface PriorityOrder {
  info: string;              // bytes32
  inputToken: string;        // address
  outputToken: string;       // address
  inputAmount: bigint;       // uint256
  minOutputAmount: bigint;   // uint256
  swapper: string;           // address
  deadline: bigint;          // uint256
  fee: bigint;               // uint256
}

/**
 * Settlement execution options
 */
export interface SettlementExecutionOptions {
  gasLimit?: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  value?: bigint;  // For ETH payments
}

/**
 * Encode execute function call
 */
export function encodeExecuteCall(
  order: PriorityOrder,
  signature: string
): string {
  const iface = createSettlementInterface();
  return iface.encodeFunctionData('execute', [
    [
      order.info,
      order.inputToken,
      order.outputToken,
      order.inputAmount,
      order.minOutputAmount,
      order.swapper,
      order.deadline,
      order.fee,
    ],
    signature,
  ]);
}

/**
 * Encode batch execute function call
 */
export function encodeBatchExecuteCall(
  orders: PriorityOrder[],
  signatures: string[]
): string {
  const iface = createSettlementInterface();
  return iface.encodeFunctionData('executeBatch', [
    orders.map((order) => [
      order.info,
      order.inputToken,
      order.outputToken,
      order.inputAmount,
      order.minOutputAmount,
      order.swapper,
      order.deadline,
      order.fee,
    ]),
    signatures,
  ]);
}

/**
 * Estimate gas for executing an order
 */
export async function estimateExecuteGas(
  settlement: ethers.Contract,
  order: PriorityOrder,
  signature: string,
  fromAddress: string
): Promise<bigint> {
  try {
    const gasEstimate = await settlement.execute.estimateGas(
      [
        order.info,
        order.inputToken,
        order.outputToken,
        order.inputAmount,
        order.minOutputAmount,
        order.swapper,
        order.deadline,
        order.fee,
      ],
      signature,
      { from: fromAddress }
    );
    
    // Add 20% buffer for safety
    return (gasEstimate * BigInt(120)) / BigInt(100);
  } catch (error: any) {
    console.error('[error] Gas estimation failed:', error.message);
    // Default to safe estimate
    return BigInt(300000);
  }
}

/**
 * Execute an order on-chain
 */
export async function executeOrder(
  settlement: ethers.Contract,
  order: PriorityOrder,
  signature: string,
  options?: SettlementExecutionOptions
): Promise<ethers.ContractTransactionResponse | null> {
  try {
    const tx = await settlement.execute(
      [
        order.info,
        order.inputToken,
        order.outputToken,
        order.inputAmount,
        order.minOutputAmount,
        order.swapper,
        order.deadline,
        order.fee,
      ],
      signature,
      options || {}
    );

    return tx;
  } catch (error: any) {
    console.error('[error] Order execution failed:', error.message);
    throw error;
  }
}

/**
 * Wait for order execution confirmation
 */
export async function waitForOrderExecution(
  tx: ethers.ContractTransactionResponse,
  confirmations: number = 1
): Promise<ethers.TransactionReceipt | null> {
  try {
    const receipt = await tx.wait(confirmations);
    return receipt;
  } catch (error: any) {
    console.error('[error] Failed to confirm order execution:', error.message);
    throw error;
  }
}

/**
 * Parse Fill event from transaction receipt
 */
export function parseFillEvent(
  receipt: ethers.TransactionReceipt
): { orderHash: string; filler: string; swapper: string; nonce: bigint } | null {
  if (!receipt) return null;

  const iface = createSettlementInterface();

  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === 'Fill') {
        return {
          orderHash: parsed.args[0],
          filler: parsed.args[1],
          swapper: parsed.args[2],
          nonce: parsed.args[3],
        };
      }
    } catch (e) {
      // Not a Fill event, continue
    }
  }

  return null;
}

/**
 * Get Fill topic for filtering events
 */
export function getFillEventTopic(): string {
  return ethers.id('Fill(bytes32,address,address,uint256)');
}

/**
 * Format order for logging
 */
export function formatOrderForLogging(order: PriorityOrder): string {
  return `Order{
    inputToken: ${order.inputToken.slice(0, 10)}...,
    outputToken: ${order.outputToken.slice(0, 10)}...,
    inputAmount: ${order.inputAmount},
    minOutputAmount: ${order.minOutputAmount},
    swapper: ${order.swapper.slice(0, 10)}...,
    deadline: ${order.deadline},
    fee: ${order.fee}
  }`;
}

/**
 * Validate order before execution
 */
export function validateOrder(order: PriorityOrder): { valid: boolean; error?: string } {
  if (!order.inputToken || order.inputToken === '0x0000000000000000000000000000000000000000') {
    return { valid: false, error: 'Invalid input token' };
  }

  if (!order.outputToken || order.outputToken === '0x0000000000000000000000000000000000000000') {
    return { valid: false, error: 'Invalid output token' };
  }

  if (order.inputAmount <= BigInt(0)) {
    return { valid: false, error: 'Invalid input amount' };
  }

  if (order.minOutputAmount <= BigInt(0)) {
    return { valid: false, error: 'Invalid minimum output amount' };
  }

  if (order.deadline <= BigInt(Math.floor(Date.now() / 1000))) {
    return { valid: false, error: 'Order deadline has passed' };
  }

  return { valid: true };
}
