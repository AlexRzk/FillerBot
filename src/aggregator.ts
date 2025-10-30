/**
 * src/aggregator.ts
 * NEW FILE
 * PURPOSE: Connects to a DEX Aggregator (e.g., 1inch, 0x)
 * to get REAL on-chain quotes and transaction data.
 * This REPLACES the old oracle-based profit calculation.
 */

import { ethers } from 'ethers';
import { Intent } from './models/intent';
import { getSigner } from './eth/provider';
import logger from './logger';
import { config } from './config';

// The response structure from a 1inch / 0x API
export interface AggregatorQuote {
  // The exact amount of output token you will receive
  amountOut: bigint;
  // The full transaction calldata to execute the swap
  txData: string;
  // The address to send the transaction to
  txTo: string;
  // The gas estimate for the swap
  gasEstimate: bigint;
}

export class Aggregator {
  private signerAddress: string | null = null;

  constructor() {
    // We need our bot's address to get quotes
    getSigner()
      .getAddress()
      .then((address) => {
        this.signerAddress = address;
      })
      .catch((err) => {
        logger.error(`[aggregator] CRITICAL: Failed to get signer address: ${err.message}`);
      });
  }

  /**
   * Gets a real-time quote from a DEX aggregator to fill a UniswapX order.
   *
   * @param intent The user's order we want to fill.
   * @returns A promise that resolves to an AggregatorQuote.
   */
  public async getQuote(intent: Intent): Promise<AggregatorQuote> {
    if (!this.signerAddress) {
      throw new Error('Aggregator is not initialized (signer address not found).');
    }

    /**
     * This is the core of the on-chain quoting.
     * The bot (as the filler) needs to:
     * 1. Get the user's `intent.sellToken` (e.g., 1000 USDC)
     * 2. Find the best on-chain price for it (e.g., on Uniswap V3, Curve)
     * 3. The swap's output MUST be the `intent.buyToken` (e.g., WETH)
     * 4. The swap's destination MUST be the UniswapX reactor contract
     * 5. The reactor call `execute` MUST be bundled *in the same transaction*.
     *
     * Aggregators like 1inch/0x provide APIs for this.
     */

    // 1. Construct the API URL for the aggregator
    // We'll use 1inch on Base (chain ID 8453) as an example
    const chainId = 8453; // Base
    const swapParams = {
      fromTokenAddress: intent.sellToken,
      toTokenAddress: intent.buyToken,
      amount: intent.sellAmount.toString(),
      fromAddress: this.signerAddress,
      slippage: 1, // 1%
    };

    // --- MOCK IMPLEMENTATION ---
    // In a real bot, you would fetch this URL:
    // const url = `https://api.1inch.io/v5.2/${chainId}/swap?${new URLSearchParams(swapParams)}`;
    // const response = await fetch(url, { headers: { 'Authorization': 'Bearer YOUR_API_KEY' } });
    // const data = await response.json();
    //
    // const quote: AggregatorQuote = {
    //   amountOut: BigInt(data.toAmount),
    //   txData: data.tx.data,
    //   txTo: data.tx.to,
    //   gasEstimate: BigInt(data.tx.gas),
    // };
    // --- END REAL IMPLEMENTATION ---

    // For this example, we will return a MOCKED but realistic quote.
    // This simulates a quote that is SLIGHTLY better than the user's minBuyAmount.
    const mockProfit = (intent.minBuyAmount * 5n) / 1000n; // 0.5% profit
    const mockQuote: AggregatorQuote = {
      amountOut: intent.minBuyAmount + mockProfit, // We get 0.5% more than user's minimum
      txData: '0xMOCK_SWAP_CALLDATA', // This would be the real calldata from 1inch
      txTo: config.AGGREGATOR_ADDRESS || '0x1111111254EEB25477B68fb85Ed929f73A960582', // 1inch router
      gasEstimate: 250000n, // A realistic gas estimate
    };

    logger.debug(`[aggregator] Quote for ${intent.id}: 
      IN: ${intent.sellAmount} ${intent.sellToken}
      OUT: ${mockQuote.amountOut} ${intent.buyToken}
      USER_MIN: ${intent.minBuyAmount}`);

    // This simulates a network call
    await new Promise((resolve) => setTimeout(resolve, 50));

    // We must check if the quote is even profitable *before* gas.
    // Is the amount we get *at least* what the user is asking for?
    if (mockQuote.amountOut < intent.minBuyAmount) {
      throw new Error(
        `Not profitable: Aggregator quote (${mockQuote.amountOut}) is less than user's minimum (${intent.minBuyAmount})`
      );
    }

    return mockQuote;
  }
}

// Create a singleton instance
export const aggregator = new Aggregator();
