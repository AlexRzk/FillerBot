
/**
 * src/index.ts
 * PURPOSE: Main entry point for the intent solver application.
 * Initializes all components and starts the monitor loop.
 */

import * as readline from 'readline';
import { config } from './config';
import logger from './logger';
import { getDatabase, saveIntent } from './db/sqlite';
import { getProvider, getSigner, startHealthChecks } from './eth/provider';
import { startMonitor, stopMonitor } from './monitor/monitor';
import { startOrderbookListener } from './listener/orderbook';
import { startMockFeed } from './listener/mockFeed';
import { ethers } from 'ethers';

// Mock contract addresses (in local mode, these are deployed by scripts/deploy-mocks.ts)
// IMPORTANT: Deploy contracts first with: npx hardhat run scripts/deploy-mocks.ts --network localhost
// Then update this address with the deployed settlement contract address
const SETTLEMENT_ADDRESS = process.env.SETTLEMENT_ADDRESS || '0x9fE46736679d2D9a65F0991C02F50800747f9C5d'; // Will be overridden if env var set

/**
 * Main function.
 */
async function main(): Promise<void> {
  try {
    logger.info(`Starting intent solver in ${config.MODE} mode`);
    logger.info(`Configuration loaded: chain=${config.CHAIN_ID}, db=${config.DATABASE_PATH}`);

    // Initialize database
    logger.info('Initializing database...');
    getDatabase();
    logger.info('Database initialized');

    // Initialize Ethereum provider
    logger.info(`Initializing provider with RPC: ${config.RPC_URLS[0]}`);
    const provider = getProvider();
    startHealthChecks(provider as ethers.FallbackProvider, 30000);
    logger.info('Provider initialized');

    // Initialize signer
    logger.info('Initializing signer...');
    const signer = getSigner();
    const signerAddr = await signer.getAddress();
    logger.info(`Signer initialized: ${signerAddr}`);

    // Log safety warnings for live mode
    if (config.MODE === 'live') {
      if (!config.ENABLE_LIVE) {
        throw new Error('FATAL: Live mode requires ENABLE_LIVE=true');
      }
      logger.warn('');
      logger.warn('╔═════════════════════════════════════════════════════════════════╗');
      logger.warn('║  LIVE MODE ACTIVATED - REAL TRANSACTIONS WILL BE SUBMITTED      ║');
      logger.warn('║  Ensure you understand the risks and have reviewed all code     ║');
      logger.warn('║  Double-check contract addresses, gas limits, and slippage      ║');
      logger.warn('╚═════════════════════════════════════════════════════════════════╝');
      logger.warn('');
    }

    // Start the appropriate intent feed
    if (config.INTENT_FEED_SOURCE === 'real') {
      if (!config.ORDERBOOK_API_KEY || !config.ORDERBOOK_WS_URL) {
        throw new Error('ORDERBOOK_API_KEY and ORDERBOOK_WS_URL must be set for real feed');
      }
      logger.info('Using REAL intent feed from orderbook WebSocket.');
      startOrderbookListener(config.ORDERBOOK_API_KEY, config.ORDERBOOK_WS_URL, saveIntent);
    } else {
      logger.info('Using MOCK intent feed from local JSON file.');
      startMockFeed(saveIntent, config.MONITOR_INTERVAL_MS);
    }

    // Start monitor
    logger.info('Starting monitor loop...');
    await startMonitor(SETTLEMENT_ADDRESS);
    logger.info('Monitor loop running');

    // Handle graceful shutdown
    setupGracefulShutdown();
  } catch (error) {
    logger.error(`Fatal error: ${error}`);
    process.exit(1);
  }
}

/**
 * Setup graceful shutdown on signals.
 */
function setupGracefulShutdown(): void {
  const signals = ['SIGINT', 'SIGTERM'];

  for (const signal of signals) {
    process.on(signal, () => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      stopMonitor();
      process.exit(0);
    });
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  logger.info('Type "exit" and press Enter to shutdown');

  rl.on('line', (line: string) => {
    if (line.trim().toLowerCase() === 'exit') {
      logger.info('Shutting down...');
      stopMonitor();
      rl.close();
      process.exit(0);
    }
  });
}

// Run main
main().catch((error) => {
  logger.error(`Unhandled error: ${error}`);
  process.exit(1);
});
