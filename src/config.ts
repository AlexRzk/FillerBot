
/**
 * src/config.ts
 * PURPOSE: Load and validate configuration from environment variables.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
  MODE: z.enum(['local', 'live']).default('local'),
  RPC_URLS: z.string()
    .transform(val => val.split(',').map(v => v.trim()).filter(v => v.length > 0))
    .pipe(z.array(z.string().url()))
    .default('http://127.0.0.1:8545'),
  FORK_URL: z.preprocess(
    (val) => val === '' ? undefined : val,
    z.string().url().optional()
  ),
  PRIVATE_KEY: z.string(),
  CHAIN_ID: z.string().transform(Number).default('31337'),
  DATABASE_PATH: z.string().default('./data/bot.db'),
  ENABLE_LIVE: z.string().transform(val => val === 'true').default('false'),
  INTENT_FEED_SOURCE: z.enum(['mock', 'real']).default('mock'),
  MOCK_FEED_FILE: z.string().default('./seeds/mock_intents.json'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  MONITOR_INTERVAL_MS: z.string().transform(Number).default('2000'),
  MIN_PROFIT_THRESHOLD: z.string().transform(BigInt).default('1000000000000000'),
  UNISWAPX_WEBHOOK_PORT: z.string().transform(Number).default('8080'),
  ORDERBOOK_API_KEY: z.string().optional(),
  ORDERBOOK_WS_URL: z.string().url().optional(),
  SUBMITTER_RETRY_COUNT: z.string().transform(Number).default('3'),
  SUBMITTER_RETRY_DELAY_MS: z.string().transform(Number).default('1000'),
  FLASHBOTS_RPC_URL: z.string().url().optional(),
  FLASHBOTS_AUTH_KEY: z.string().optional(),
});

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  // Handle RPC_URL vs RPC_URLS naming mismatch
  if (process.env.RPC_URL && !process.env.RPC_URLS) {
    process.env.RPC_URLS = process.env.RPC_URL;
  }

  const parsed = configSchema.parse(process.env);

  if (parsed.MODE === 'live' && !parsed.ENABLE_LIVE) {
    throw new Error('FATAL: Mode is "live" but ENABLE_LIVE is not true.');
  }

  if (!parsed.PRIVATE_KEY) {
    throw new Error('FATAL: PRIVATE_KEY environment variable is not set');
  }

  const dbDir = path.dirname(parsed.DATABASE_PATH);
  if (!dbDir.includes('.') && dbDir !== '') {
    // TODO: Create directory if needed using fs.mkdirSync
  }

  return parsed;
}

export const config = loadConfig();
