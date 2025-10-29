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
 * Chainlink Price Feed Addresses on Base Mainnet
 * Source: https://docs.chain.link/data-feeds/price-feeds/addresses?network=base
 */
export const CHAINLINK_FEEDS_BASE = {
  // ETH/USD - Base mainnet
  'ETH/USD': '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
  
  // Wrapped tokens (use same feed as base token)
  'WETH/USD': '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
  
  // Stablecoins
  'USDC/USD': '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B',
  'USDbC/USD': '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B', // Bridged USDC uses same feed
  'DAI/USD': '0x591e79239a7d679378eC8c847e5038150364C78F',
  
  // Bitcoin
  'cbBTC/USD': '0x07DA0E54543a844a80ABE69c8A12F22B3aA59f9D', // Coinbase Wrapped BTC
};

/**
 * Token addresses on Base mainnet
 */
export const TOKEN_ADDRESSES_BASE: Record<string, string> = {
  WETH: '0x4200000000000000000000000000000000000006',
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  USDbC: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', // Bridged USDC
  DAI: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
  cbBTC: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', // Coinbase Wrapped BTC
};

/**
 * Get Chainlink feed address for a token pair on Base
 */
export function getChainlinkFeed(tokenAddress: string): string | null {
  const token = Object.entries(TOKEN_ADDRESSES_BASE).find(
    ([_, addr]) => addr.toLowerCase() === tokenAddress.toLowerCase()
  );
  
  if (!token) return null;
  
  const feedKey = `${token[0]}/USD` as keyof typeof CHAINLINK_FEEDS_BASE;
  return CHAINLINK_FEEDS_BASE[feedKey] || null;
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
