/**
 * Trade Validator
 * 
 * Validates every trade against safety limits before execution.
 * Prevents losing money by rejecting unsafe trades.
 */

/**
 * Validate a trade against all safety rules
 * @param intent The intent to fill
 * @param simulationResult The result from the staticCall simulation
 * @param provider ethers provider
 * @returns Validation result with details
 */
/**
 * Trade Validator
 *
 * Validates every trade against safety limits before execution.
 * Prevents losing money by rejecting unsafe trades.
 */

import { ethers } from 'ethers';
import { Intent } from '../models/intent';
import { SAFETY_CONFIG, TradeValidation } from '../config/safety';
import { convertToUSD, getTokenDecimals } from '../utils/priceOracle';
import { circuitBreaker } from '../utils/circuitBreaker';
import { SimulationResult } from '../simulator/simulator'; // Import SimulationResult

/**
 * Validate a trade against all safety rules
 * @param intent The intent to fill
 * @param simulationResult The result from the staticCall simulation
 * @param provider ethers provider
 * @returns Validation result with details
 */
export async function validateTrade(
  intent: Intent,
  simulationResult: SimulationResult, // Use the simulation result
  provider: ethers.Provider
): Promise<TradeValidation> {
  
  // These values are from the simulation, not new estimates
  const estimatedGasUnits = simulationResult.gasEstimate;
  const l1Fee = simulationResult.l1Fee;
  let estimatedProfitUSD = 0;
  let estimatedGasCostUSD = 0;
  let positionSizeUSD = 0;
  let slippagePercent = 0;

  try {
    // Check if circuit breaker is active
    if (circuitBreaker.isPaused()) {
      return {
        isValid: false,
        reason: `Circuit breaker is active: ${circuitBreaker.getState().reason}`,
        estimatedProfitUSD, estimatedGasCostUSD, positionSizeUSD, slippagePercent,
      };
    }

    // Get token decimals
    const sellDecimals = getTokenDecimals(intent.sellToken);
    const buyDecimals = getTokenDecimals(intent.buyToken);

    // Convert amounts to USD
    const [sellAmountUSD, buyAmountUSD, ethPriceUSD] = await Promise.all([
      convertToUSD(
        intent.sellAmount,
        intent.sellToken,
        sellDecimals,
        provider
      ),
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
        18,
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
    
    const l2GasCostWei = estimatedGasUnits * gasPrice;
    const totalGasCostWei = l2GasCostWei + l1Fee;
    
    estimatedGasCostUSD = parseFloat(ethers.formatEther(totalGasCostWei)) * ethPriceUSD;

    // Check gas cost limit
    if (estimatedGasCostUSD > SAFETY_CONFIG.MAX_GAS_COST_USD) {
      return {
        isValid: false,
        reason: `Gas cost ($${estimatedGasCostUSD.toFixed(2)}) exceeds limit ($${SAFETY_CONFIG.MAX_GAS_COST_USD})`,
        estimatedProfitUSD, estimatedGasCostUSD, positionSizeUSD, slippagePercent,
      };
    }

    // Calculate estimated profit
    // This is a simplified profit calc; a real one would use the simulation's output amounts
    estimatedProfitUSD = buyAmountUSD - sellAmountUSD - estimatedGasCostUSD;

    // Check minimum profit requirement
    if (estimatedProfitUSD < SAFETY_CONFIG.MIN_PROFIT_USD) {
      return {
        isValid: false,
        reason: `Estimated profit ($${estimatedProfitUSD.toFixed(2)}) below minimum ($${SAFETY_CONFIG.MIN_PROFIT_USD})`,
        estimatedProfitUSD, estimatedGasCostUSD, positionSizeUSD, slippagePercent,
      };
    }

    // Calculate slippage (simplified)
    slippagePercent = buyAmountUSD > 0 ? ((sellAmountUSD / buyAmountUSD) - 1) * 100 : 0;
    if (slippagePercent < 0) slippagePercent = 0; // Only care about negative slippage

    // Check slippage limit
    if (slippagePercent > SAFETY_CONFIG.MAX_SLIPPAGE_PERCENT) {
      return {
        isValid: false,
        reason: `Slippage (${slippagePercent.toFixed(2)}%) exceeds limit (${SAFETY_CONFIG.MAX_SLIPPAGE_PERCENT}%)`,
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
    console.log(`  - Slippage: ${slippagePercent.toFixed(2)}%`);

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

