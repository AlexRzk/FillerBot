/**
 * src/config.ts
 * PURPOSE: Load and validate configuration from environment variables.
 * This is the single source of truth for all configuration across the application.
 * 
 * SAFETY: All real network submission is gated behind ENABLE_LIVE=true.
 * Local mode is the default and safe for testing without real broadcasts.
 * 
 * TODO: Add config validation schema using zod or similar library
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

export interface Config {
  // Mode: 'local' (test node, no broadcasts) or 'live' (real network, requires ENABLE_LIVE=true)
  mode: 'local' | 'live';

  // RPC endpoint URL
  rpcUrl: string;

  // Fork URL for Anvil (optional)
  forkUrl?: string;

  // Private key for signing (dev/test only)
  privateKey: string;

  // Chain ID
  chainId: number;

  // Database file path
  databasePath: string;

  // Enable live network submission (must be explicitly true)
  enableLive: boolean;

  // Intent feed source: 'mock' (local JSON) or 'real' (Optimism mainnet APIs)
  intentFeedSource: 'mock' | 'real';

  // Mock intents feed file path
  mockFeedFile: string;

  // Logging level
  logLevel: 'debug' | 'info' | 'warn' | 'error';

  // Monitor loop interval (ms)
  monitorIntervalMs: number;

  // Minimum profit threshold (in wei)
  minProfitThreshold: bigint;
}

function loadConfig(): Config {
  const mode = (process.env.MODE || 'local') as 'local' | 'live';
  const enableLive = process.env.ENABLE_LIVE === 'true';

  // Safety check: enforce ENABLE_LIVE=true for live mode
  if (mode === 'live' && !enableLive) {
    throw new Error(
      'FATAL: Mode is "live" but ENABLE_LIVE is not true. Set ENABLE_LIVE=true to enable live submission.'
    );
  }

  // Ensure private key is set
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('FATAL: PRIVATE_KEY environment variable is not set');
  }

  const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:8545';
  const chainId = parseInt(process.env.CHAIN_ID || '31337', 10);
  const databasePath = process.env.DATABASE_PATH || './data/bot.db';
  const mockFeedFile = process.env.MOCK_FEED_FILE || './seeds/mock_intents.json';
  const intentFeedSource = (process.env.INTENT_FEED_SOURCE || 'mock') as 'mock' | 'real';
  const logLevel = (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error';
  const monitorIntervalMs = parseInt(process.env.MONITOR_INTERVAL_MS || '2000', 10);
  const minProfitThreshold = BigInt(process.env.MIN_PROFIT_THRESHOLD || '1000000000000000');

  // Ensure database directory exists
  const dbDir = path.dirname(databasePath);
  if (!dbDir.includes('.') && dbDir !== '') {
    // TODO: Create directory if needed using fs.mkdirSync
  }

  return {
    mode,
    rpcUrl,
    forkUrl: process.env.FORK_URL,
    privateKey,
    chainId,
    databasePath,
    enableLive,
    intentFeedSource,
    mockFeedFile,
    logLevel,
    monitorIntervalMs,
    minProfitThreshold,
  };
}

export const config = loadConfig();
