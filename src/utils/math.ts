/**
 * src/utils/math.ts
 * PURPOSE: Mathematical utilities for token amount conversions and price calculations.
 * Handles BigInt arithmetic to avoid floating-point precision issues.
 * 
 * TODO: Add SafeMath checks for overflow/underflow
 * TODO: Add slippage tolerance calculations
 * TODO: Add decimal conversion helpers for different token decimals
 */

/**
 * Calculate swap output using constant product formula: x * y = k
 * This is the standard Uniswap-style AMM pricing.
 * 
 * formula: amountOut = (amountIn * reserveOut) / (reserveIn + amountIn)
 * 
 * @param amountIn Amount of input token (in wei)
 * @param reserveIn Reserve of input token (in wei)
 * @param reserveOut Reserve of output token (in wei)
 * @returns Amount of output token (in wei)
 */
export function computeAmountOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint
): bigint {
  if (amountIn <= 0n) {
    throw new Error('Amount in must be positive');
  }
  if (reserveIn <= 0n || reserveOut <= 0n) {
    throw new Error('Reserves must be positive');
  }

  const numerator = amountIn * reserveOut;
  const denominator = reserveIn + amountIn;
  return numerator / denominator;
}

/**
 * Calculate the price (in quote token) for a given amount of base token.
 * Used to compute slippage and price impact.
 * 
 * @param amountBase Amount of base token (in wei)
 * @param pricePerUnit Price of 1 unit of base token (in wei of quote token)
 * @returns Price in quote token (in wei)
 */
export function calculatePrice(amountBase: bigint, pricePerUnit: bigint): bigint {
  return (amountBase * pricePerUnit) / 10n ** 18n; // Assuming 18 decimal places
}

/**
 * Calculate gas cost in quote token.
 * 
 * @param gasUsed Amount of gas used
 * @param gasPrice Gas price in wei per gas
 * @param quotePrice Price of token per ETH (in wei)
 * @returns Gas cost in quote token (in wei)
 */
export function calculateGasCost(
  gasUsed: bigint,
  gasPrice: bigint,
  _quotePrice: bigint
): bigint {
  const gasCostInETH = gasUsed * gasPrice; // Result is in wei
  // TODO: Convert ETH cost to quote token using price oracle
  return gasCostInETH;
}

/**
 * Calculate profit/loss for a settlement.
 * 
 * profit = (amountBought - amountSold) - gasCost
 * 
 * @param amountBought Amount received (in wei)
 * @param amountSold Amount spent (in wei)
 * @param gasCost Cost of gas (in wei)
 * @returns Profit (positive) or loss (negative) in wei
 */
export function calculatePnL(
  amountBought: bigint,
  amountSold: bigint,
  gasCost: bigint
): bigint {
  return amountBought - amountSold - gasCost;
}

/**
 * Scale an amount from one decimal precision to another.
 * Useful when dealing with tokens that have different decimal places.
 * 
 * @param amount Amount to scale (in wei of source token)
 * @param fromDecimals Current decimal places
 * @param toDecimals Target decimal places
 * @returns Scaled amount (in wei of target token)
 */
export function scaleAmount(
  amount: bigint,
  fromDecimals: number,
  toDecimals: number
): bigint {
  if (fromDecimals === toDecimals) {
    return amount;
  }

  if (fromDecimals > toDecimals) {
    const divisor = 10n ** BigInt(fromDecimals - toDecimals);
    return amount / divisor;
  } else {
    const multiplier = 10n ** BigInt(toDecimals - fromDecimals);
    return amount * multiplier;
  }
}

/**
 * Calculate slippage tolerance for a swap.
 * 
 * slippageAmount = expectedAmount * slippageBps / 10000
 * where bps = basis points (100 bps = 1%)
 * 
 * @param expectedAmount Expected output amount (in wei)
 * @param slippageBps Slippage tolerance in basis points (e.g., 50 for 0.5%)
 * @returns Slippage amount (in wei)
 */
export function calculateSlippage(expectedAmount: bigint, slippageBps: number): bigint {
  return (expectedAmount * BigInt(slippageBps)) / 10000n;
}

/**
 * Calculate minimum acceptable amount after slippage.
 * 
 * @param expectedAmount Expected output amount (in wei)
 * @param slippageBps Slippage tolerance in basis points
 * @returns Minimum amount after slippage (in wei)
 */
export function calculateMinAmount(expectedAmount: bigint, slippageBps: number): bigint {
  const slippage = calculateSlippage(expectedAmount, slippageBps);
  return expectedAmount - slippage;
}
