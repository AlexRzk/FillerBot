
/**
 * src/db/sqlite.ts
 * PURPOSE: SQLite database layer for persisting intents and execution runs.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import logger from '../logger';
import { Intent } from '../models/intent';

let db: Database.Database | null = null;

function runMigrations(database: Database.Database) {
  logger.info('Running database migrations...');
  database.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

  let version = 0;
  try {
    const row = database.prepare('SELECT value FROM meta WHERE key = ?').get('version') as { value: string };
    if (row) {
      version = parseInt(row.value, 10);
    }
  } catch (error) {
    // meta table might not exist yet
  }

  const migrationDir = path.join(__dirname, '../../migrations');
  const migrationFiles = fs.readdirSync(migrationDir).sort();

  for (const file of migrationFiles) {
    const fileVersion = parseInt(file.split('_')[0], 10);
    if (fileVersion > version) {
      logger.info(`Applying migration: ${file}`);
      const sql = fs.readFileSync(path.join(migrationDir, file), 'utf-8');
      database.exec(sql);
      database.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('version', fileVersion.toString());
    }
  }
  logger.info('Database migrations complete.');
}

function initDatabase(): Database.Database {
  if (db) return db;

  const dbPath = config.DATABASE_PATH;
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    logger.info(`Created database directory: ${dbDir}`);
  }

  try {
    db = new Database(dbPath);
    logger.info(`Database connected: ${dbPath}`);
    runMigrations(db);
  } catch (error) {
    logger.error(`Failed to initialize database: ${error}`);
    throw error;
  }

  return db;
}

export function getDatabase(): Database.Database {
  if (!db) {
    initDatabase();
  }
  return db!;
}

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

export function saveRun(run: any): void {
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
