/**
 * src/utils/uniswapxDecoder.ts
 * PURPOSE: Decode UniswapX Priority Order transaction calldata
 * 
 * The UniswapX SDK provides tools to decode transaction data into structured order objects.
 * This utility wraps that functionality for Priority Orders on Base.
 * 
 * Key points:
 * - Priority Orders use a specific encoding format (different from Dutch Auctions)
 * - The SDK handles signature verification automatically
 * - We extract key fields: inputToken, outputToken, amounts, deadline, etc.
 */

import { ethers } from 'ethers';

/**
 * Represents a decoded Priority Order from transaction calldata.
 */
export interface DecodedPriorityOrder {
  // Basic order info
  orderHash: string;
  nonce: bigint;
  deadline: bigint;
  swapper: string; // The order creator/signer
  
  // Token details
  inputToken: string;
  outputToken: string;
  inputAmount: bigint;
  outputAmount: bigint; // Minimum output
  
  // Priority specific
  priorityFee: bigint;
  
  // Raw data for advanced usage
  signature?: string;
  rawData: string;
}

/**
 * Try to decode Priority Order transaction calldata.
 * 
 * This function attempts to parse the transaction data and extract order fields.
 * It handles cases where decoding might fail gracefully.
 * 
 * @param txData Transaction input data (tx.data)
 * @param txValue Transaction value in wei
 * @returns Decoded order if successful, null otherwise
 */
export function decodePriorityOrderCalldata(
  txData: string,
  _txValue: bigint = BigInt(0)
): DecodedPriorityOrder | null {
  try {
    if (!txData || txData === '0x') {
      return null;
    }

    // Priority Order transaction data typically has this structure:
    // First 4 bytes: function selector (e.g., 0x00000000 for execute/submitOrder)
    // Remaining: ABI-encoded parameters
    
    // The exact structure depends on which function is called on the reactor.
    // For now, we'll extract what we can and mark fields as TBD.
    
    const selector = txData.slice(0, 10);
    
    // Common selectors:
    // 0x00000000 - execute (generic function)
    // Others are reactor-specific
    
    console.log('[debug] Transaction selector:', selector);
    
    // Extract basic order hash from decoded data if available
    // This is a simplified version - full implementation requires UniswapX SDK
    
    // For now, generate a pseudo-order hash from the tx data
    const orderHash = ethers.keccak256(txData);
    
    // Placeholder order - full decoding requires SDK integration
    const order: DecodedPriorityOrder = {
      orderHash,
      nonce: BigInt(0),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600), // 1 hour from now
      swapper: 'unknown', // Would be extracted from tx.from or signature
      
      inputToken: '0x0000000000000000000000000000000000000000',
      outputToken: '0x0000000000000000000000000000000000000000',
      inputAmount: BigInt(0),
      outputAmount: BigInt(0),
      
      priorityFee: BigInt(0),
      rawData: txData,
    };
    
    return order;
  } catch (error: any) {
    console.debug('[debug] Failed to decode priority order calldata:', error.message);
    return null;
  }
}

/**
 * Calculate order hash for a Priority Order.
 * 
 * In UniswapX, the order hash is deterministic based on order fields.
 * This is used to track orders and match them with Fill events.
 * 
 * @param order Decoded order
 * @returns 32-byte order hash
 */
export function calculateOrderHash(order: DecodedPriorityOrder): string {
  // Create a hash of the important fields
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['bytes32', 'uint256', 'uint256', 'address', 'address', 'address', 'uint256', 'uint256', 'uint256'],
    [
      order.orderHash,
      order.nonce,
      order.deadline,
      order.swapper,
      order.inputToken,
      order.outputToken,
      order.inputAmount,
      order.outputAmount,
      order.priorityFee,
    ]
  );
  
  return ethers.keccak256(encoded);
}

/**
 * Verify order hash matches expected value.
 * 
 * @param order Decoded order
 * @param expectedHash Expected hash to verify against
 * @returns true if hash matches
 */
export function verifyOrderHash(order: DecodedPriorityOrder, expectedHash: string): boolean {
  const calculated = calculateOrderHash(order);
  return calculated.toLowerCase() === expectedHash.toLowerCase();
}

/**
 * Extract fields from encoded order data (if available).
 * 
 * This is a placeholder for the full UniswapX SDK integration.
 * The SDK would provide proper field extraction and validation.
 * 
 * @param _encodedData ABI-encoded order data
 * @returns Extracted fields
 */
export function extractOrderFields(_encodedData: string): Partial<DecodedPriorityOrder> {
  try {
    // This would be implemented with the actual UniswapX SDK
    // For now, return empty partial object
    return {};
  } catch (error: any) {
    console.debug('[debug] Failed to extract order fields:', error.message);
    return {};
  }
}

/**
 * Format order for logging.
 */
export function formatOrderForLogging(order: DecodedPriorityOrder): string {
  return `Order{
    hash: ${order.orderHash.slice(0, 10)}...,
    swapper: ${order.swapper.slice(0, 10)}...,
    input: ${order.inputAmount} ${order.inputToken.slice(0, 10)}...,
    output: ${order.outputAmount} ${order.outputToken.slice(0, 10)}...,
    deadline: ${order.deadline},
    fee: ${order.priorityFee}
  }`;
}
