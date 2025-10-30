/**
 * src/index.ts
 * PURPOSE: Main entry point for the intent solver application.
 * Initializes all components and starts the monitor loop.
 * ---
 * CRITICAL FIX: Removed incorrect listener logic. The monitor
 * is now responsible for starting the correct feed (real or mock).
 */

import * as readline from 'readline';
import { config } from './config';
import logger from './logger';
import { getDatabase } from './db/sqlite';
import { getProvider, getSigner, startHealthChecks } from './eth/provider';
import { startMonitor, stopMonitor } from './monitor/monitor';
import { ethers } from 'ethers';

// This address is from your deploy-addresses.json
// It is the MOCK settlement contract.
// For Base Mainnet, this MUST be changed to the real UniswapX reactor.
const SETTLEMENT_ADDRESS_LOCAL = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0'; 
const SETTLEMENT_ADDRESS_BASE = '0x000000001Ec5656dcdB24D90DFa42742738De729'; // UniswapX Reactor on Base

/**
 * Main function.
 */
async function main(): Promise<void> {
  try {
    logger.info(`Starting intent solver in ${process.env.MODE} mode`);
    logger.info(`Configuration loaded: chain=${process.env.CHAIN_ID}, db=${process.env.DATABASE_PATH}`);

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

    let settlementAddress: string;

    // Log safety warnings for live mode
    if (config.MODE === 'live') {
      if (!process.env.ENABLE_LIVE) {
        throw new Error('FATAL: Live mode requires ENABLE_LIVE=true');
      }
      logger.warn('');
      logger.warn('╔═════════════════════════════════════════════════════════════════╗');
      logger.warn('║  LIVE MODE ACTIVATED - REAL TRANSACTIONS WILL BE SUBMITTED      ║');
      logger.warn('╚═════════════════════════════════════════════════════════════════╝');
      logger.warn('');
      
      // Use the REAL Base reactor address
      settlementAddress = SETTLEMENT_ADDRESS_BASE;
      logger.info(`Using Base Mainnet UniswapX Reactor: ${settlementAddress}`);

      if (Number(process.env.CHAIN_ID) !== 8453) {
         logger.warn(`WARNING: MODE=live but CHAIN_ID is not 8453 (Base). Config CHAIN_ID is ${process.env.CHAIN_ID}`);
      }

    } else {
      // Use the LOCAL mock settlement address
      settlementAddress = SETTLEMENT_ADDRESS_LOCAL;
      logger.info(`Using LOCAL MockSettlement Contract: ${settlementAddress}`);
    }

    // ---
    // CORRECTED LOGIC: All listener logic is now handled inside startMonitor()
    // ---
    logger.info('Starting monitor loop...');
    await startMonitor(settlementAddress); // Pass the correct address
    logger.info('Monitor loop running');

    // Handle graceful shutdown
    setupGracefulShutdown();
  } catch (error) {
    logger.error(`Fatal error: ${error}`);
    process.exit(1);
  }
}

// (setupGracefulShutdown function remains the same)

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