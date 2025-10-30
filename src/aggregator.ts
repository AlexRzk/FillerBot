/**
 * src/aggregator.ts
 * REWRITTEN: To use a REAL 1inch API fetch call.
 * This is the "brain" of your bot.
 */

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

// --- CONFIGURATION ---
// 1. Get your API key from https://portal.1inch.dev/
// 2. Add API_KEY to your .env file
const API_KEY = process.env.API_KEY_1INCH; // Make sure to add this to your .env
const API_BASE_URL = 'https://api.1inch.dev/swap/v6.0';
// --- END CONFIGURATION ---

export class Aggregator {
  private signerAddress: string | null = null;
  private apiHeaders: Record<string, string>;

  constructor() {
    if (!API_KEY) {
      throw new Error('API_KEY is not set in your .env file. Get one from https://portal.1inch.dev/');
    }
    
    this.apiHeaders = {
      'Authorization': `Bearer ${API_KEY}`,
      'Accept': 'application/json'
    };

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
   */
  public async getQuote(intent: Intent): Promise<AggregatorQuote> {
    if (!this.signerAddress) {
      throw new Error('Aggregator is not initialized (signer address not found).');
    }
    
    // 1. Construct the API URL for the 1inch aggregator
    const chainId = config.CHAIN_ID; // 8453 for Base
    const swapParams = {
      src: intent.sellToken,
      dst: intent.buyToken,
      amount: intent.sellAmount.toString(),
      from: this.signerAddress,
      // We are the filler, so the receiver of the swap output
      // is our own bot's address. The 1inch txData will handle
      // swapping and then calling the UniswapX reactor.
      receiver: this.signerAddress,
      // The UniswapX reactor is the 'spender' of our input tokens
      // We must tell 1inch to generate txData that approves this address.
      // NOTE: This assumes you have pre-approved the 1inch router.
      // A more complex setup might be needed if 1inch needs to approve the *reactor*.
      // For most aggregator fills, you just need to approve the 1inch router.
      // Let's assume the 1inch router (tx.to) handles the interaction.
      slippage: '0.5', // 0.5% slippage
      disableEstimate: 'true', // We do our own simulation
      // compatibilityMode: 'true', // May be needed for UniswapX
    };

    // --- REAL IMPLEMENTATION ---
    const url = `${API_BASE_URL}/${chainId}/swap?${new URLSearchParams(swapParams)}`;
    let data: any;

    try {
      const response = await fetch(url, { headers: this.apiHeaders });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`1inch API error (${response.status}): ${errorText}`);
      }
      data = await response.json();
      
      const quote: AggregatorQuote = {
        amountOut: BigInt(data.dstAmount),
        txData: data.tx.data,
        txTo: data.tx.to,
        gasEstimate: BigInt(data.tx.gas) + 50000n, // Add buffer
      };

      logger.debug(`[aggregator] Quote for ${intent.id}: 
        IN: ${intent.sellAmount} ${intent.sellToken}
        OUT: ${quote.amountOut} ${intent.buyToken}
        USER_MIN: ${intent.minBuyAmount}`);
      
      // We must check if the quote is even profitable *before* gas.
      if (quote.amountOut < intent.minBuyAmount) {
        throw new Error(
          `Not profitable: Aggregator quote (${quote.amountOut}) is less than user's minimum (${intent.minBuyAmount})`
        );
      }
      
      return quote;

    } catch (error: any) {
      logger.error(`[aggregator] Failed to get 1inch quote: ${error.message}`);
      throw error;
    }
    // --- END REAL IMPLEMENTATION ---
  }
}

// Create a singleton instance
export const aggregator = new Aggregator();