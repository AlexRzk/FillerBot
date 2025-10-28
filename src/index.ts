/**
 * src/index.ts
 * PURPOSE: Main entry point for the intent solver application.
 * Initializes all components and starts the monitor loop.
 * 
 * FLOW:
 * 1. Load config
 * 2. Initialize logger
 * 3. Initialize database
 * 4. Initialize Ethereum provider
 * 5. Start monitor
 * 6. Handle graceful shutdown
 * 
 * TODO: Add command-line argument parsing
 * TODO: Add HTTP server for metrics and health checks
 * TODO: Add configuration hot-reload
 * TODO: Add multi-chain support
 */

import * as readline from 'readline';
import { config } from './config';
import logger from './logger';
import { getDatabase } from './db/sqlite';
import { getProvider, getSigner } from './eth/provider';
import { startMonitor, stopMonitor } from './monitor/monitor';

// Mock contract addresses (in local mode, these are deployed by scripts/deploy-mocks.ts)
const SETTLEMENT_ADDRESS = '0x9fE46736679d2D9a65F0991C02F50800747f9C5d'; // Placeholder
const AMM_ADDRESS = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9'; // Placeholder

/**
 * Main function.
 */
async function main(): Promise<void> {
  try {
    logger.info(`Starting intent solver in ${config.mode} mode`);
    logger.info(`Configuration loaded: chain=${config.chainId}, db=${config.databasePath}`);

    // TODO: Add argument parsing
    // Example:
    // const args = process.argv.slice(2);
    // if (args.includes('--mode')) {
    //   const modeIdx = args.indexOf('--mode');
    //   const mode = args[modeIdx + 1];
    //   // override config.mode
    // }

    // Initialize database
    logger.info('Initializing database...');
    getDatabase();
    logger.info('Database initialized');

    // Initialize Ethereum provider
    logger.info(`Initializing provider with RPC: ${config.rpcUrl}`);
    // Initialize provider
    getProvider();
    logger.info('Provider initialized');

    // Initialize signer
    logger.info('Initializing signer...');
    const signer = getSigner();
    const signerAddr = await signer.getAddress();
    logger.info(`Signer initialized: ${signerAddr}`);

    // Log safety warnings for live mode
    if (config.mode === 'live') {
      if (!config.enableLive) {
        throw new Error('FATAL: Live mode requires ENABLE_LIVE=true');
      }
      logger.warn('');
      logger.warn('╔═════════════════════════════════════════════════════════════════╗');
      logger.warn('║  LIVE MODE ACTIVATED - REAL TRANSACTIONS WILL BE SUBMITTED      ║');
      logger.warn('║  Ensure you understand the risks and have reviewed all code     ║');
      logger.warn('║  Double-check contract addresses, gas limits, and slippage      ║');
      logger.warn('╚═════════════════════════════════════════════════════════════════╝');
      logger.warn('');
    } else {
      logger.info('Running in LOCAL mode - Safe for testing, no real broadcasts');
    }

    // TODO: Add HTTP metrics server
    // Example:
    // const app = express();
    // app.get('/health', (req, res) => res.json({ status: 'ok' }));
    // app.listen(3000, () => logger.info('Metrics server on :3000'));

    // Start monitor
    logger.info('Starting monitor loop...');
    await startMonitor(SETTLEMENT_ADDRESS, AMM_ADDRESS);
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

  // Also support interactive console input
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
