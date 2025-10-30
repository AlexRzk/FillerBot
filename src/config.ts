
/**
 * src/config.ts
 * PURPOSE: Load and validate configuration from environment variables.
 */

import * as dotenv from 'dotenv';
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



import * as fs from 'fs';

const amms = JSON.parse(fs.readFileSync('./amms.json', 'utf-8'));

export const config = {
  MODE: process.env.MODE || 'local',
  RPC_URLS: (process.env.RPC_URLS || 'http://127.0.0.1:8545').split(','),
  PRIVATE_KEY: process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  ENABLE_LIVE: process.env.ENABLE_LIVE === 'true',
  DATABASE_PATH: process.env.DATABASE_PATH || './data/bot.db',
  MOCK_FEED_FILE: process.env.MOCK_FEED_FILE || './seeds/mock_intents.json',
  MIN_PROFIT_THRESHOLD: BigInt(process.env.MIN_PROFIT_THRESHOLD || '1000000000000000'),
  CHAIN_ID: parseInt(process.env.CHAIN_ID || '31337', 10),
  SUBMITTER_RETRY_COUNT: parseInt(process.env.SUBMITTER_RETRY_COUNT || '3', 10),
  SUBMITTER_RETRY_DELAY_MS: parseInt(process.env.SUBMITTER_RETRY_DELAY_MS || '1000', 10),
  INTENT_FEED_SOURCE: process.env.INTENT_FEED_SOURCE || 'mock',
  ORDERBOOK_API_KEY: process.env.ORDERBOOK_API_KEY,
  ORDERBOOK_WS_URL: process.env.ORDERBOOK_WS_URL,
  UNISWAPX_WEBHOOK_PORT: parseInt(process.env.UNISWAPX_WEBHOOK_PORT || '8080', 10),
  MONITOR_INTERVAL_MS: parseInt(process.env.MONITOR_INTERVAL_MS || '5000', 10),
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  amms,
};
