/**
 * scripts/demo.ts
 * PURPOSE: Demonstration script that runs the solver in local mode with synthetic intents.
 * Runs for a fixed duration, then prints a summary of executions and profits.
 * 
 * USAGE:
 *   npm run demo
 * 
 * TODO: Add command-line arguments for duration and intent generation
 * TODO: Add interactive mode with per-cycle feedback
 * TODO: Add visualization of matching and profits
 */

import { config } from '../src/config';
import logger from '../src/logger';
import { getDatabase, getRuns, getPositiveProfitRuns, calculateTotalPnL } from '../src/db/sqlite';
import { getMockIntents } from '../src/listener/mockFeed';
import { startMonitor, stopMonitor } from '../src/monitor/monitor';

// Demo configuration
const DEMO_DURATION_MS = 10000; // Run for 10 seconds
const SETTLEMENT_ADDRESS = '0x9fE46736679d2D9a65F0991C02F50800747f9C5d'; // Mock from deploy


/**
 * Run the demo.
 */
async function runDemo() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║          Intent Solver Demo - Local Mode              ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('');

  try {
    // Initialize
    logger.info('Initializing demo...');
    getDatabase(); // Initialize DB
    logger.info(`Database ready: ${config.databasePath}`);

    // Load mock intents
    const mockIntents = getMockIntents();
    logger.info(`Loaded ${mockIntents.length} mock intents for demo`);

    if (mockIntents.length === 0) {
      console.log('⚠️  No mock intents found. Create seeds/mock_intents.json first.');
      process.exit(1);
    }

    // Print mock intents
    console.log('📋 Mock intents:');
    mockIntents.forEach((intent, i) => {
      console.log(
        `  ${i + 1}. ${intent.id.substring(0, 8)}... : ${intent.sellAmount}@${intent.sellToken.substring(0, 6)} -> ${intent.minBuyAmount}@${intent.buyToken.substring(0, 6)}`
      );
    });
    console.log('');

    // Start monitor
    logger.info('Starting monitor loop...');
    console.log(`⏱️  Demo will run for ${DEMO_DURATION_MS / 1000} seconds`);
    console.log('');

    await startMonitor(SETTLEMENT_ADDRESS);

    // Wait for demo duration
    await new Promise((resolve) => setTimeout(resolve, DEMO_DURATION_MS));

    // Stop monitor
    stopMonitor();
    await new Promise((resolve) => setTimeout(resolve, 500)); // Give time to flush logs

    // Print summary
    printDemoSummary();
  } catch (error) {
    logger.error(`Demo error: ${error}`);
    stopMonitor();
    process.exit(1);
  }
}

/**
 * Print demo summary with results.
 */
function printDemoSummary() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║               Demo Summary                             ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('');

  try {
    // Fetch all runs
    const allRuns = getRuns();
    const profitableRuns = getPositiveProfitRuns();
    const pnl = calculateTotalPnL();

    console.log('📊 Execution Results:');
    console.log(`   Total runs: ${allRuns.length}`);
    console.log(`   Profitable runs: ${profitableRuns.length}`);
    console.log(`   Failed runs: ${allRuns.length - profitableRuns.length}`);
    console.log('');

    console.log('💰 P&L Summary:');
    console.log(`   Total profit: ${pnl.totalProfit.toString()} wei`);
    console.log(`   Total loss:   ${pnl.totalLoss.toString()} wei`);
    console.log(`   Executed runs: ${pnl.count}`);
    console.log('');

    if (allRuns.length > 0) {
      console.log('📝 Run Details:');
      allRuns.slice(0, 5).forEach((run, i) => {
        const status = run.actualProfit && run.actualProfit > 0n ? '✅' : '❌';
        const profit = run.actualProfit?.toString() || 'N/A';
        console.log(`   ${i + 1}. ${status} ${run.id.substring(0, 8)}... : ${profit} wei`);
      });

      if (allRuns.length > 5) {
        console.log(`   ... and ${allRuns.length - 5} more`);
      }
    } else {
      console.log('ℹ️  No runs executed. This is normal if no profitable matches were found.');
      console.log('   Tip: Adjust MIN_PROFIT_THRESHOLD in .env to lower value.');
    }

    console.log('');
    console.log('📚 Database: ' + config.databasePath);
    console.log('   View results with: sqlite3 ' + config.databasePath);
    console.log('   Query: SELECT * FROM runs;');
    console.log('');

    console.log('✅ Demo complete!');
    console.log('');
  } catch (error) {
    logger.error(`Failed to print summary: ${error}`);
  }
}

// Run demo
runDemo().catch((error) => {
  logger.error(`Unhandled error: ${error}`);
  process.exit(1);
});
