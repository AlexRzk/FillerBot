/**
 * Safety Configuration for Production Deployment
 * 
 * CRITICAL: These limits protect against losing money in production.
 * DO NOT modify these values without thorough testing.
 */

// Helper parsers for environment variables with safe defaults
const envNum = (key: string, def: number): number => {
  const v = process.env[key];
  return v !== undefined && v !== '' ? Number(v) : def;
};

const envInt = (key: string, def: number): number => {
  const v = process.env[key];
  return v !== undefined && v !== '' ? parseInt(v, 10) : def;
};

const envBool = (key: string, def: boolean): boolean => {
  const v = process.env[key];
  if (v === undefined || v === '') return def;
  return v.toLowerCase() === 'true' || v === '1';
};

export const SAFETY_CONFIG = {
  // Position limits (in USD)
  MAX_POSITION_SIZE_USD: envNum('SAFETY_MAX_POSITION_SIZE_USD', 50.0),
  MIN_PROFIT_USD: envNum('SAFETY_MIN_PROFIT_USD', 0.50),
  MAX_LOSS_PER_HOUR_USD: envNum('SAFETY_MAX_LOSS_PER_HOUR_USD', 10.0),
  MAX_LOSS_PER_DAY_USD: envNum('SAFETY_MAX_LOSS_PER_DAY_USD', 25.0),

  // Slippage protection
  MAX_SLIPPAGE_PERCENT: envNum('SAFETY_MAX_SLIPPAGE_PERCENT', 2.0),

  // Gas limits
  MAX_GAS_COST_USD: envNum('SAFETY_MAX_GAS_COST_USD', 5.0),
  GAS_BUFFER_MULTIPLIER: envNum('SAFETY_GAS_BUFFER_MULTIPLIER', 1.3),

  // Price oracle settings
  PRICE_STALENESS_SECONDS: envInt('SAFETY_PRICE_STALENESS_SECONDS', 3600),
  MAX_PRICE_DEVIATION_PERCENT: envNum('SAFETY_MAX_PRICE_DEVIATION_PERCENT', 10.0),

  // Transaction settings
  MAX_PENDING_TXS: envInt('SAFETY_MAX_PENDING_TXS', 3),
  TX_TIMEOUT_SECONDS: envInt('SAFETY_TX_TIMEOUT_SECONDS', 180),
  MAX_RETRIES: envInt('SAFETY_MAX_RETRIES', 3),
  RETRY_DELAY_MS: envInt('SAFETY_RETRY_DELAY_MS', 5000),

  // Circuit breakers
  MAX_FAILED_TXS_PER_HOUR: envInt('SAFETY_MAX_FAILED_TXS_PER_HOUR', 5),
  CIRCUIT_BREAKER_COOLDOWN_MS: envInt('SAFETY_CIRCUIT_BREAKER_COOLDOWN_MS', 3600000),

  // Simulation requirements
  REQUIRE_SIMULATION: envBool('SAFETY_REQUIRE_SIMULATION', true),
  SIMULATION_GAS_BUFFER: envNum('SAFETY_SIMULATION_GAS_BUFFER', 1.5),

  // Monitoring
  LOG_ALL_INTENTS: envBool('SAFETY_LOG_ALL_INTENTS', true),
  LOG_REJECTED_TRADES: envBool('SAFETY_LOG_REJECTED_TRADES', true),
  ALERT_ON_CIRCUIT_BREAK: envBool('SAFETY_ALERT_ON_CIRCUIT_BREAK', true),
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
