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

/**
 * Validate a trade against all safety rules
 * 
 * @param intent The intent to fill
 * @param estimatedGasUnits Estimated gas units
 * @param provider ethers provider
 * @returns Validation result with details
 */
export async function validateTrade(
  intent: Intent,
  estimatedGasUnits: bigint,
  provider: ethers.Provider
): Promise<TradeValidation> {
  try {
    // Check if circuit breaker is active
    if (circuitBreaker.isPaused()) {
      return {
        isValid: false,
        reason: `Circuit breaker is active: ${circuitBreaker.getState().reason}`,
        estimatedProfitUSD: 0,
        estimatedGasCostUSD: 0,
        positionSizeUSD: 0,
        slippagePercent: 0,
      };
    }

    // Get token decimals
    const sellDecimals = getTokenDecimals(intent.sellToken);
    const buyDecimals = getTokenDecimals(intent.buyToken);

    // Convert amounts to USD
    const sellAmountUSD = await convertToUSD(
      intent.sellAmount,
      intent.sellToken,
      sellDecimals,
      provider
    );

    const buyAmountUSD = await convertToUSD(
      intent.minBuyAmount,
      intent.buyToken,
      buyDecimals,
      provider
    );

    // Calculate position size (max of sell or buy amount)
    const positionSizeUSD = Math.max(sellAmountUSD, buyAmountUSD);

    // Check position size limit
    if (positionSizeUSD > SAFETY_CONFIG.MAX_POSITION_SIZE_USD) {
      return {
        isValid: false,
        reason: `Position size ($${positionSizeUSD.toFixed(2)}) exceeds limit ($${SAFETY_CONFIG.MAX_POSITION_SIZE_USD})`,
        estimatedProfitUSD: 0,
        estimatedGasCostUSD: 0,
        positionSizeUSD,
        slippagePercent: 0,
      };
    }

    // Estimate gas cost
    const gasPrice = await provider.getFeeData();
    const gasPriceGwei = Number(gasPrice.gasPrice || 0n);
    const gasCostWei = estimatedGasUnits * BigInt(gasPriceGwei);
    
    // Convert gas cost to USD (assume 1 ETH = price from oracle)
    const gasCostETH = Number(gasCostWei) / 1e18;
    const ethPriceUSD = await convertToUSD(
      BigInt(1e18), // 1 ETH
      '0x4200000000000000000000000000000000000006', // WETH on Optimism
      18,
      provider
    );
    const gasCostUSD = gasCostETH * ethPriceUSD;

    // Check gas cost limit
    if (gasCostUSD > SAFETY_CONFIG.MAX_GAS_COST_USD) {
      return {
        isValid: false,
        reason: `Gas cost ($${gasCostUSD.toFixed(2)}) exceeds limit ($${SAFETY_CONFIG.MAX_GAS_COST_USD})`,
        estimatedProfitUSD: 0,
        estimatedGasCostUSD: gasCostUSD,
        positionSizeUSD,
        slippagePercent: 0,
      };
    }

    // Calculate estimated profit
    const estimatedProfitUSD = buyAmountUSD - sellAmountUSD - gasCostUSD;

    // Check minimum profit requirement
    if (estimatedProfitUSD < SAFETY_CONFIG.MIN_PROFIT_USD) {
      return {
        isValid: false,
        reason: `Estimated profit ($${estimatedProfitUSD.toFixed(2)}) below minimum ($${SAFETY_CONFIG.MIN_PROFIT_USD})`,
        estimatedProfitUSD,
        estimatedGasCostUSD: gasCostUSD,
        positionSizeUSD,
        slippagePercent: 0,
      };
    }

    // Calculate slippage
    const slippagePercent = buyAmountUSD > 0 ? ((sellAmountUSD / buyAmountUSD) - 1) * 100 : 0;

    // Check slippage limit
    if (slippagePercent > SAFETY_CONFIG.MAX_SLIPPAGE_PERCENT) {
      return {
        isValid: false,
        reason: `Slippage (${slippagePercent.toFixed(2)}%) exceeds limit (${SAFETY_CONFIG.MAX_SLIPPAGE_PERCENT}%)`,
        estimatedProfitUSD,
        estimatedGasCostUSD: gasCostUSD,
        positionSizeUSD,
        slippagePercent,
      };
    }

    // Check if intent is expired
    const now = Math.floor(Date.now() / 1000);
    if (intent.deadline < now) {
      return {
        isValid: false,
        reason: `Intent expired (deadline: ${intent.deadline}, now: ${now})`,
        estimatedProfitUSD,
        estimatedGasCostUSD: gasCostUSD,
        positionSizeUSD,
        slippagePercent,
      };
    }

    // All checks passed
    console.log('[validator] ✅ Trade validation passed:');
    console.log(`  - Profit: $${estimatedProfitUSD.toFixed(2)}`);
    console.log(`  - Gas: $${gasCostUSD.toFixed(2)}`);
    console.log(`  - Position: $${positionSizeUSD.toFixed(2)}`);
    console.log(`  - Slippage: ${slippagePercent.toFixed(2)}%`);

    return {
      isValid: true,
      estimatedProfitUSD,
      estimatedGasCostUSD: gasCostUSD,
      positionSizeUSD,
      slippagePercent,
    };

  } catch (error: any) {
    console.error('[validator] Validation error:', error.message);
    return {
      isValid: false,
      reason: `Validation error: ${error.message}`,
      estimatedProfitUSD: 0,
      estimatedGasCostUSD: 0,
      positionSizeUSD: 0,
      slippagePercent: 0,
    };
  }
}

/**
 * Simulate a trade execution to verify it won't revert
 * 
 * @param intent Intent to simulate
 * @param provider ethers provider
 * @returns true if simulation succeeds
 */
export async function simulateTrade(
  intent: Intent,
  _provider: ethers.Provider
): Promise<{ success: boolean; reason?: string }> {
  try {
    if (!SAFETY_CONFIG.REQUIRE_SIMULATION) {
      return { success: true };
    }

    console.log('[simulator] Simulating trade execution...');

    // TODO: Implement actual transaction simulation
    // This should:
    // 1. Fork mainnet state
    // 2. Execute the fill transaction
    // 3. Check for reverts
    // 4. Verify profit is realized
    //
    // For now, we'll do basic checks

    // Check maker has sufficient balance (would need to query on-chain)
    // Check maker has approval for tokens
    // Check our liquidity sources are available
    // Check for potential front-running

    console.log('[simulator] ⚠️  Simulation not fully implemented - using basic checks');
    
    // Basic check: intent is not expired
    const now = Math.floor(Date.now() / 1000);
    if (intent.deadline < now) {
      return { success: false, reason: 'Intent expired' };
    }

    // Basic check: amounts are non-zero
    if (intent.sellAmount === 0n || intent.minBuyAmount === 0n) {
      return { success: false, reason: 'Zero amounts' };
    }

    console.log('[simulator] ✅ Basic simulation passed');
    return { success: true };

  } catch (error: any) {
    console.error('[simulator] Simulation failed:', error.message);
    return { success: false, reason: error.message };
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
