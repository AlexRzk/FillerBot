/**
 * src/db/sqlite.ts
 * PURPOSE: SQLite database layer for persisting intents and execution runs.
 * Provides functions to save/query intents and runs.
 * 
 * DATABASE INSPECTION:
 * - Use `sqlite3 ./data/bot.db` to open the database in CLI
 * - `.schema` to view table definitions
 * - `SELECT * FROM intents; SELECT * FROM runs;` to query data
 * 
 * TODO: Add data migration system (e.g., migra or raw SQL versioning)
 * TODO: Add transaction support for atomic multi-record updates
 * TODO: Add query performance indices on frequently searched columns
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import logger from '../logger';
import { Intent } from '../models/intent';

let db: Database.Database | null = null;

/**
 * Initialize SQLite database and create tables if they don't exist.
 */
function initDatabase(): Database.Database {
  if (db) return db;

  const dbPath = config.databasePath;
  const dbDir = path.dirname(dbPath);

  // Create data directory if needed
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    logger.info(`Created database directory: ${dbDir}`);
  }

  try {
    db = new Database(dbPath);
    logger.info(`Database connected: ${dbPath}`);

    // Create intents table
    db.exec(`
      CREATE TABLE IF NOT EXISTS intents (
        id TEXT PRIMARY KEY,
        maker TEXT NOT NULL,
        sellToken TEXT NOT NULL,
        buyToken TEXT NOT NULL,
        sellAmount TEXT NOT NULL,
        minBuyAmount TEXT NOT NULL,
        deadline INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      )
    `);

    // Create runs table
    // Each run represents one execution of a settled intent pair or batch
    db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        intentIds TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        expectedProfit TEXT,
        actualProfit TEXT,
        gasUsed TEXT,
        txHash TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      )
    `);

    logger.info('Database tables initialized');
  } catch (error) {
    logger.error(`Failed to initialize database: ${error}`);
    throw error;
  }

  return db;
}

/**
 * Get database instance (lazy initialized).
 */
export function getDatabase(): Database.Database {
  if (!db) {
    initDatabase();
  }
  return db!;
}

/**
 * Save an intent to the database.
 * Creates or updates if intent with same ID already exists.
 */
export function saveIntent(intent: Intent): void {
  const database = getDatabase();
  const now = Math.floor(Date.now() / 1000);

  try {
    const stmt = database.prepare(`
      INSERT OR REPLACE INTO intents (
        id, maker, sellToken, buyToken, sellAmount, minBuyAmount,
        deadline, status, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      intent.id,
      intent.maker,
      intent.sellToken,
      intent.buyToken,
      intent.sellAmount.toString(),
      intent.minBuyAmount.toString(),
      intent.deadline,
      intent.status,
      intent.createdAt,
      now
    );

    logger.debug(`Saved intent: ${intent.id}`);
  } catch (error) {
    logger.error(`Failed to save intent: ${error}`);
    throw error;
  }
}

/**
 * Get all pending intents from the database.
 */
export function getPendingIntents(): Intent[] {
  const database = getDatabase();

  try {
    const stmt = database.prepare('SELECT * FROM intents WHERE status = ?');
    const rows = stmt.all('pending') as any[];

    return rows.map((row) => ({
      id: row.id,
      maker: row.maker,
      sellToken: row.sellToken,
      buyToken: row.buyToken,
      sellAmount: BigInt(row.sellAmount),
      minBuyAmount: BigInt(row.minBuyAmount),
      deadline: row.deadline,
      status: row.status,
      createdAt: row.createdAt,
    }));
  } catch (error) {
    logger.error(`Failed to fetch pending intents: ${error}`);
    throw error;
  }
}

/**
 * Save a run (execution record) to the database.
 */
export interface Run {
  id: string;
  intentIds: string[]; // IDs of intents settled in this run
  status: 'pending' | 'executing' | 'executed' | 'failed';
  expectedProfit?: bigint;
  actualProfit?: bigint;
  gasUsed?: bigint;
  txHash?: string;
  createdAt: number;
  updatedAt: number;
}

export function saveRun(run: Run): void {
  const database = getDatabase();
  const now = Math.floor(Date.now() / 1000);

  try {
    const stmt = database.prepare(`
      INSERT OR REPLACE INTO runs (
        id, intentIds, status, expectedProfit, actualProfit,
        gasUsed, txHash, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      run.id,
      JSON.stringify(run.intentIds),
      run.status,
      run.expectedProfit?.toString() || null,
      run.actualProfit?.toString() || null,
      run.gasUsed?.toString() || null,
      run.txHash || null,
      run.createdAt,
      now
    );

    logger.debug(`Saved run: ${run.id}`);
  } catch (error) {
    logger.error(`Failed to save run: ${error}`);
    throw error;
  }
}

/**
 * Get all runs from the database.
 */
export function getRuns(): Run[] {
  const database = getDatabase();

  try {
    const stmt = database.prepare('SELECT * FROM runs ORDER BY createdAt DESC');
    const rows = stmt.all() as any[];

    return rows.map((row) => ({
      id: row.id,
      intentIds: JSON.parse(row.intentIds),
      status: row.status,
      expectedProfit: row.expectedProfit ? BigInt(row.expectedProfit) : undefined,
      actualProfit: row.actualProfit ? BigInt(row.actualProfit) : undefined,
      gasUsed: row.gasUsed ? BigInt(row.gasUsed) : undefined,
      txHash: row.txHash,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  } catch (error) {
    logger.error(`Failed to fetch runs: ${error}`);
    throw error;
  }
}

/**
 * Get runs with positive profit.
 */
export function getPositiveProfitRuns(): Run[] {
  const allRuns = getRuns();
  return allRuns.filter((run) => run.actualProfit && run.actualProfit > 0n);
}

/**
 * Calculate total profit and loss from all executed runs.
 */
export function calculateTotalPnL(): { totalProfit: bigint; totalLoss: bigint; count: number } {
  const runs = getRuns();
  let totalProfit = 0n;
  let totalLoss = 0n;
  let count = 0;

  for (const run of runs) {
    if (run.actualProfit && run.status === 'executed') {
      count++;
      if (run.actualProfit > 0n) {
        totalProfit += run.actualProfit;
      } else {
        totalLoss += run.actualProfit; // Already negative
      }
    }
  }

  return { totalProfit, totalLoss, count };
}
