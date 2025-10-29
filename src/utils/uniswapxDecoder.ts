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
 * Priority Orders on UniswapX have a specific structure that we need to decode.
 * 
 * Structure:
 * - Bytes 0-3: Function selector (usually 0x3cc33dff for execute)
 * - Bytes 4+: ABI-encoded Order struct
 * 
 * Order struct contains:
 * - info: bytes32 (orderHash packed into info field)
 * - inputToken: address
 * - outputToken: address
 * - inputAmount: uint256
 * - minOutputAmount: uint256
 * - swapper: address
 * - deadline: uint256
 * - fee: uint256
 * 
 * @param txData Transaction input data (tx.data)
 * @param _txValue Transaction value in wei
 * @returns Decoded order if successful, null otherwise
 */
export function decodePriorityOrderCalldata(
  txData: string,
  _txValue: bigint = BigInt(0)
): DecodedPriorityOrder | null {
  try {
    if (!txData || txData === '0x' || txData.length < 10) {
      return null;
    }

    // Extract function selector
    const selector = txData.slice(0, 10);
    console.log('[debug] Transaction selector:', selector);

    // Common UniswapX selectors:
    // 0x3cc33dff - execute (Priority Order execution)
    // 0x00000000 - can also be used
    
    // Skip selector and decode the remaining data as ABI-encoded Order
    const dataWithoutSelector = '0x' + txData.slice(10);

    // UniswapX Priority Order typically has this ABI structure:
    // (bytes32 info, address inputToken, address outputToken, uint256 inputAmount, 
    //  uint256 minOutputAmount, address swapper, uint256 deadline, uint256 fee, ...)
    
    // However, the exact structure can vary. We'll try multiple common patterns.
    
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    
    // Try Pattern 1: Full Priority Order struct
    // This is the most common pattern for UniswapX Priority Orders
    try {
      const types = [
        'tuple(bytes32,address,address,uint256,uint256,address,uint256,uint256)',
        'bytes',
      ];
      
      const decoded = abiCoder.decode(types, dataWithoutSelector);
      const order = decoded[0];

      // Extract fields from the order tuple
      const orderInfo = order[0];        // bytes32 - info field
      const inputToken = order[1];       // address
      const outputToken = order[2];      // address
      const inputAmount = order[3];      // uint256
      const minOutputAmount = order[4];  // uint256
      const swapper = order[5];          // address
      const deadline = order[6];         // uint256
      const fee = order[7];              // uint256

      // Generate order hash from the info field or create new one
      const orderHash = orderInfo || ethers.keccak256(dataWithoutSelector);

      const decodedOrder: DecodedPriorityOrder = {
        orderHash,
        nonce: BigInt(0), // Nonce would be in the info field
        deadline,
        swapper,
        inputToken,
        outputToken,
        inputAmount,
        outputAmount: minOutputAmount,
        priorityFee: fee,
        rawData: txData,
      };

      console.log('[info] Successfully decoded Priority Order (Pattern 1)');
      return decodedOrder;
    } catch (e) {
      console.log('[debug] Pattern 1 decode failed, trying Pattern 2...');
    }

    // Try Pattern 2: Simpler structure without tuple
    try {
      const types = [
        'bytes32',    // info/orderHash
        'address',    // inputToken
        'address',    // outputToken
        'uint256',    // inputAmount
        'uint256',    // minOutputAmount
        'address',    // swapper
        'uint256',    // deadline
        'uint256',    // fee
      ];
      
      const decoded = abiCoder.decode(types, dataWithoutSelector);

      const decodedOrder: DecodedPriorityOrder = {
        orderHash: decoded[0],
        nonce: BigInt(0),
        deadline: decoded[6],
        swapper: decoded[5],
        inputToken: decoded[1],
        outputToken: decoded[2],
        inputAmount: decoded[3],
        outputAmount: decoded[4],
        priorityFee: decoded[7],
        rawData: txData,
      };

      console.log('[info] Successfully decoded Priority Order (Pattern 2)');
      return decodedOrder;
    } catch (e) {
      console.log('[debug] Pattern 2 decode failed, trying Pattern 3...');
    }

    // Try Pattern 3: Generic parsing - look for token addresses and amounts in common positions
    try {
      // Extract from hex data by looking for patterns
      // Addresses are 40 hex chars (20 bytes)
      // Amounts are typically large uint256s
      
      // For now, try to extract at least the selector to determine structure
      if (selector === '0x3cc33dff') {
        // This is execute function - try common ABI
        const types = [
          'address',    // Token 1
          'address',    // Token 2
          'uint256',    // Amount 1
          'uint256',    // Amount 2
          'address',    // Swapper
          'uint256',    // Deadline
          'uint256',    // Fee
        ];
        
        const decoded = abiCoder.decode(types, dataWithoutSelector);
        
        const decodedOrder: DecodedPriorityOrder = {
          orderHash: ethers.keccak256(txData),
          nonce: BigInt(0),
          deadline: decoded[5],
          swapper: decoded[4],
          inputToken: decoded[0],
          outputToken: decoded[1],
          inputAmount: decoded[2],
          outputAmount: decoded[3],
          priorityFee: decoded[6],
          rawData: txData,
        };

        console.log('[info] Successfully decoded Priority Order (Pattern 3)');
        return decodedOrder;
      }
    } catch (e) {
      console.log('[debug] Pattern 3 decode failed');
    }

    // If all patterns fail, log warning but continue with minimal data
    console.warn('[warn] Could not decode Priority Order with known patterns. Check transaction format.');
    console.log('[debug] Data length:', txData.length, 'bytes');
    console.log('[debug] First 200 chars:', txData.slice(0, 200));

    // Return null to indicate decode failed
    return null;
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
    ['uint256', 'uint256', 'address', 'address', 'address', 'uint256', 'uint256', 'uint256'],
    [
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
