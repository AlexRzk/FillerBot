/**
 * Safety Configuration for Production Deployment
 * 
 * CRITICAL: These limits protect against losing money in production.
 * DO NOT modify these values without thorough testing.
 */

export const SAFETY_CONFIG = {
  // Position limits (in USD)
  MAX_POSITION_SIZE_USD: 50.0,          // Maximum $50 per trade
  MIN_PROFIT_USD: 0.50,                 // Minimum $0.50 profit required
  MAX_LOSS_PER_HOUR_USD: 10.0,          // Circuit breaker: max $10 loss/hour
  MAX_LOSS_PER_DAY_USD: 25.0,           // Circuit breaker: max $25 loss/day
  
  // Slippage protection
  MAX_SLIPPAGE_PERCENT: 2.0,            // Maximum 2% slippage allowed
  
  // Gas limits
  MAX_GAS_COST_USD: 5.0,                // Maximum $5 gas cost per trade
  GAS_BUFFER_MULTIPLIER: 1.3,           // Add 30% buffer to gas estimates
  
  // Price oracle settings
  PRICE_STALENESS_SECONDS: 3600,        // 1 hour max age for price data
  MAX_PRICE_DEVIATION_PERCENT: 10.0,    // Circuit breaker: 10% price deviation
  
  // Transaction settings
  MAX_PENDING_TXS: 3,                   // Maximum pending transactions
  TX_TIMEOUT_SECONDS: 180,              // 3 minute timeout for tx confirmation
  MAX_RETRIES: 3,                       // Maximum retry attempts
  RETRY_DELAY_MS: 5000,                 // 5 seconds between retries
  
  // Circuit breakers
  MAX_FAILED_TXS_PER_HOUR: 5,           // Auto-pause after 5 failures
  CIRCUIT_BREAKER_COOLDOWN_MS: 3600000, // 1 hour cooldown after circuit break
  
  // Simulation requirements
  REQUIRE_SIMULATION: true,             // MUST simulate before every trade
  SIMULATION_GAS_BUFFER: 1.5,           // 50% extra gas for simulation safety
  
  // Monitoring
  LOG_ALL_INTENTS: true,                // Log every intent seen
  LOG_REJECTED_TRADES: true,            // Log why trades were rejected
  ALERT_ON_CIRCUIT_BREAK: true,         // Alert when circuit breaker triggers
};

/**
 * Chainlink Price Feed Addresses on Optimism Mainnet
 * Source: https://docs.chain.link/data-feeds/price-feeds/addresses?network=optimism
 */
export const CHAINLINK_FEEDS_OPTIMISM = {
  // ETH/USD - Optimism mainnet
  'ETH/USD': '0x13e3Ee699D1909E989722E753853AE30b17e08c5',
  
  // Wrapped tokens (use same feed as base token)
  'WETH/USD': '0x13e3Ee699D1909E989722E753853AE30b17e08c5',
  
  // Stablecoins
  'USDC/USD': '0x16a9FA2FDa030272Ce99B29CF780dFA30361E0f3',
  'USDT/USD': '0xECef79E109e997bCA29c1c0897ec9d7b03647F5E',
  'DAI/USD': '0x8dBa75e83DA73cc766A7e5a0ee71F656BAb470d6',
  
  // Other tokens
  'OP/USD': '0x0D276FC14719f9292D5C1eA2198673d1f4269246',
  'WBTC/USD': '0x718A5788b89454aAE3A028AE9c111A29Be6c2a6F',
};

/**
 * Token addresses on Optimism mainnet
 */
export const TOKEN_ADDRESSES_OPTIMISM: Record<string, string> = {
  WETH: '0x4200000000000000000000000000000000000006',
  USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  USDT: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
  DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
  OP: '0x4200000000000000000000000000000000000042',
  WBTC: '0x68f180fcCe6836688e9084f035309E29Bf0A2095',
};

/**
 * Get Chainlink feed address for a token pair
 */
export function getChainlinkFeed(tokenAddress: string): string | null {
  const token = Object.entries(TOKEN_ADDRESSES_OPTIMISM).find(
    ([_, addr]) => addr.toLowerCase() === tokenAddress.toLowerCase()
  );
  
  if (!token) return null;
  
  const feedKey = `${token[0]}/USD` as keyof typeof CHAINLINK_FEEDS_OPTIMISM;
  return CHAINLINK_FEEDS_OPTIMISM[feedKey] || null;
}

/**
 * Circuit breaker state
 */
export interface CircuitBreakerState {
  isPaused: boolean;
  reason: string;
  triggeredAt: number;
  lossInLastHour: number;
  lossInLastDay: number;
  failedTxsInLastHour: number;
}

/**
 * Trade validation result
 */
export interface TradeValidation {
  isValid: boolean;
  reason?: string;
  estimatedProfitUSD: number;
  estimatedGasCostUSD: number;
  positionSizeUSD: number;
  slippagePercent: number;
}
