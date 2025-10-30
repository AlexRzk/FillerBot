/**
 * src/aggregator.ts
 * REWRITTEN: To use the REAL 0x (Matcha) API for high-performance quotes.
 * This solves the 1inch rate-limit problem.
 */

import { Intent } from './models/intent';
import { getSigner } from './eth/provider';
import logger from './logger';

// The response structure from an aggregator API
export interface AggregatorQuote {
  amountOut: bigint;
  txData: string;
  txTo: string;
  gasEstimate: bigint;
}

// --- CONFIGURATION ---
// 1. Get your free API key from https://dashboard.0x.org/
// 2. Add API_KEY_0X to your .env file
const API_KEY_0X = process.env.API_KEY_0X; // Read from config
const API_BASE_URL = 'https://base.api.0x.org/swap/v1/quote'; // 0x API for Base
// --- END CONFIGURATION ---

export class Aggregator {
  private signerAddress: string | null = null;
  private apiHeaders: Record<string, string>;

  constructor() {
    if (!API_KEY_0X) {
      throw new Error('API_KEY_0X is not set in your .env file. Get one from https://dashboard.0x.org/');
    }
    
    this.apiHeaders = {
      '0x-api-key': API_KEY_0X,
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
   * Gets a real-time quote from the 0x DEX aggregator.
   */
  public async getQuote(intent: Intent): Promise<AggregatorQuote> {
    if (!this.signerAddress) {
      throw new Error('Aggregator is not initialized (signer address not found).');
    }
    
    // 1. Construct the API URL for the 0x aggregator
    const swapParams = new URLSearchParams({
      sellToken: intent.sellToken,
      buyToken: intent.buyToken,
      sellAmount: intent.sellAmount.toString(),
      // The filler (our bot) is the one taking the quote
      takerAddress: this.signerAddress, 
    });

    // --- REAL IMPLEMENTATION ---
    const url = `${API_BASE_URL}?${swapParams.toString()}`;
    let data: any;

    try {
      const response = await fetch(url, { headers: this.apiHeaders });
      
      if (!response.ok) {
        const errorText = await response.text();
        let errorJson;
        try {
          errorJson = JSON.parse(errorText);
        } catch(e) {
          // not a json error
        }
        
        // 0x API gives specific error reasons
        if (errorJson && errorJson.validationErrors) {
           throw new Error(`0x API Validation Error: ${errorJson.validationErrors[0].description}`);
        }
        if (errorJson && errorJson.reason) {
           throw new Error(`0x API Error: ${errorJson.reason}`);
        }
        throw new Error(`0x API error (${response.status}): ${errorText}`);
      }
      
      data = await response.json();
      
      const quote: AggregatorQuote = {
        amountOut: BigInt(data.buyAmount),
        txData: data.data,
        txTo: data.to,
        gasEstimate: BigInt(data.gas) + 50000n, // Add buffer
      };

      logger.debug(`[aggregator] 0x Quote for ${intent.id}: 
        IN: ${intent.sellAmount} ${intent.sellToken}
        OUT: ${quote.amountOut} ${intent.buyToken}
        USER_MIN: ${intent.minBuyAmount}`);
      
      // We must check if the quote is even profitable *before* gas.
      if (quote.amountOut < intent.minBuyAmount) {
        throw new Error(
          `Not profitable: 0x quote (${quote.amountOut}) is less than user's minimum (${intent.minBuyAmount})`
        );
      }
      
      return quote;

    } catch (error: any) {
      logger.warn(`[aggregator] Failed to get 0x quote: ${error.message}`);
      throw error;
    }
    // --- END REAL IMPLEMENTATION ---
  }
}

// Create a singleton instance
export const aggregator = new Aggregator();