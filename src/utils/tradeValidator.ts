/**
 * src/utils/tradeValidator.ts
 *
 * REWRITTEN: To use the correct ASYNC decimal fetching from eth.ts
 * and to fix the missing return path in the catch block.
 */

import { ethers } from 'ethers';
import { Intent } from '../models/intent';
import { SAFETY_CONFIG, TradeValidation } from '../config/safety';
import { SimulationResult } from '../simulator/simulator';
import { circuitBreaker } from '../utils/circuitBreaker';

// Import only convertToUSD from priceOracle
import { convertToUSD } from '../utils/priceOracle';
// Import the correct async getTokenDecimals from eth.ts
import { getTokenDecimals } from '../utils/eth';

/**
 * Validate a trade against all safety rules
 * @param intent The intent to fill
 *implements * @param simulationResult The result from the staticCall simulation
 * @param provider ethers provider
 * @returns Validation result with details
 */
export async function validateTrade(
  intent: Intent,
  simulationResult: SimulationResult,
  provider: ethers.Provider
): Promise<TradeValidation> {
  
  // These values will be reassigned
  let estimatedProfitUSD = 0;
  let estimatedGasCostUSD = 0;
  let positionSizeUSD = 0;
  // This isn't really used with a firm quote, so we set to 0.
  const slippagePercent = 0; 

  try {
    // Check if circuit breaker is active
    if (circuitBreaker.isPaused()) {
      return {
        isValid: false,
        reason: `Circuit breaker is active: ${circuitBreaker.getState().reason}`,
        estimatedProfitUSD, estimatedGasCostUSD, positionSizeUSD, slippagePercent,
      };
    }

    // --- CORRECTED ASYNC LOGIC ---
    // Fetch decimals asynchronously from eth.ts
    const [sellDecimals, buyDecimals] = await Promise.all([
      getTokenDecimals(intent.sellToken),
      getTokenDecimals(intent.buyToken)
    ]);
    
    // Get decimals for WETH (for gas calculation)
    const wethDecimals = 18; // WETH is (almost) always 18
    // --- END CORRECTION ---

    // Convert amounts to USD
    const [sellAmountUSD, buyAmountUSD, ethPriceUSD, quoteAmountOutUSD] = await Promise.all([
      // Value of what we are SELLING
      convertToUSD(
        intent.sellAmount,
        intent.sellToken,
        sellDecimals,
        provider
      ),
      // Value of what the user is ASKING FOR (minimum)
      convertToUSD(
        intent.minBuyAmount,
        intent.buyToken,
        buyDecimals,
        provider
      ),
      // Get ETH price to value gas
      convertToUSD(
        ethers.parseEther('1'), // 1 ETH
        '0x4200000000000000000000000000000000000006', // WETH on Base
        wethDecimals,
        provider
      ),
      // Value of what the aggregator is GIVING US
      convertToUSD(
        simulationResult.expectedProfitToken + intent.minBuyAmount, // This is the full amountOut
        intent.buyToken,
        buyDecimals,
        provider
      )
    ]);
    
    positionSizeUSD = Math.max(sellAmountUSD, buyAmountUSD);

    // Check position size limit
    if (positionSizeUSD > SAFETY_CONFIG.MAX_POSITION_SIZE_USD) {
      return {
        isValid: false,
        reason: `Position size ($${positionSizeUSD.toFixed(2)}) exceeds limit ($${SAFETY_CONFIG.MAX_POSITION_SIZE_USD})`,
        estimatedProfitUSD, estimatedGasCostUSD, positionSizeUSD, slippagePercent,
      };
    }

    // Estimate gas cost
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || 0n;
    
    const l2GasCostWei = simulationResult.gasEstimate * gasPrice;
    const totalGasCostWei = l2GasCostWei + simulationResult.l1Fee;
    
    estimatedGasCostUSD = parseFloat(ethers.formatEther(totalGasCostWei)) * ethPriceUSD;

    // Check gas cost limit
    if (estimatedGasCostUSD > SAFETY_CONFIG.MAX_GAS_COST_USD) {
      return {
        isValid: false,
        reason: `Gas cost ($${estimatedGasCostUSD.toFixed(2)}) exceeds limit ($${SAFETY_CONFIG.MAX_GAS_COST_USD})`,
        estimatedProfitUSD, estimatedGasCostUSD, positionSizeUSD, slippagePercent,
      };
    }
    
    // ---
    // REAL PROFIT CALCULATION (using simulator output)
    // ---
    // Profit = (Value of what we GET) - (Value of what we SELL) - (Gas Cost)
    estimatedProfitUSD = quoteAmountOutUSD - sellAmountUSD - estimatedGasCostUSD;

    // Check minimum profit requirement
    if (estimatedProfitUSD < SAFETY_CONFIG.MIN_PROFIT_USD) {
      return {
        isValid: false,
        reason: `Estimated profit ($${estimatedProfitUSD.toFixed(2)}) below minimum ($${SAFETY_CONFIG.MIN_PROFIT_USD})`,
        estimatedProfitUSD, estimatedGasCostUSD, positionSizeUSD, slippagePercent,
      };
    }

    // Check if intent is expired
    const now = Math.floor(Date.now() / 1000);
    if (intent.deadline < now) {
      return {
        isValid: false,
        reason: `Intent expired (deadline: ${intent.deadline}, now: ${now})`,
        estimatedProfitUSD, estimatedGasCostUSD, positionSizeUSD, slippagePercent,
      };
    }

    // All checks passed
    console.log('[validator] ✅ Trade validation passed:');
    console.log(`  - Profit: $${estimatedProfitUSD.toFixed(2)}`);
    console.log(`  - Gas: $${estimatedGasCostUSD.toFixed(2)}`);
    console.log(`  - Position: $${positionSizeUSD.toFixed(2)}`);

    return {
      isValid: true,
      estimatedProfitUSD,
      estimatedGasCostUSD,
      positionSizeUSD,
      slippagePercent,
    };

  } catch (error: any) {
    console.error('[validator] Validation error:', error.message);
    
    return {
      isValid: false,
      reason: `Validation error: ${error.message}`,
      estimatedProfitUSD, estimatedGasCostUSD, positionSizeUSD, slippagePercent,
    };
  }
}

/**
 * Log a rejected trade for analysis
 */
export function logRejectedTrade(intent: Intent, reason: string): void {
  if (!SAFETY_CONFIG.LOG_REJECTED_TRADES) return;

  console.log('[validator] ❌ Trade rejected:');
  console.log(`  - Intent: ${intent.id}`);
  console.log(`  - Maker: ${intent.maker}`);
  console.log(`  - Pair: ${intent.sellToken.slice(0, 10)}... → ${intent.buyToken.slice(0, 10)}...`);
  console.log(`  - Reason: ${reason}`);
}