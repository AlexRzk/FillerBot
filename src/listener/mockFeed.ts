/**
 * src/listener/mockFeed.ts
 * PURPOSE: Generate synthetic intents from a mock JSON file for local testing.
 * Simulates an intent stream without requiring external APIs.
 * 
 * TODO: Implement real API listener for CoW Protocol
 * TODO: Implement WebSocket listener for real-time intent feeds
 * TODO: Add rate-limiting and deduplication logic
 */

import * as fs from 'fs';
import { Intent } from '../models/intent';
import logger from '../logger';
import { config } from '../config';

let mockIntents: Intent[] = [];
let currentIndex = 0;

/**
 * Load mock intents from JSON file.
 */
function loadMockIntents(): Intent[] {
  try {
    const filePath = config.mockFeedFile;
    if (!fs.existsSync(filePath)) {
      logger.warn(`Mock intents file not found: ${filePath}`);
      return [];
    }

    const data = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(data);

    // Parse bigint fields
    const intents: Intent[] = parsed.map((item: Record<string, any>) => ({
      id: item.id,
      maker: item.maker,
      sellToken: item.sellToken,
      buyToken: item.buyToken,
      sellAmount: BigInt(item.sellAmount),
      minBuyAmount: BigInt(item.minBuyAmount),
      deadline: item.deadline,
      status: item.status || 'pending',
      createdAt: item.createdAt || Math.floor(Date.now() / 1000),
    }));

    logger.info(`Loaded ${intents.length} mock intents from ${filePath}`);
    return intents;
  } catch (error) {
    logger.error(`Failed to load mock intents: ${error}`);
    return [];
  }
}

/**
 * Start the mock feed generator.
 * Emits intents via callback on a fixed interval.
 * 
 * @param callback Function to call for each intent
 * @param intervalMs Interval between emissions (ms)
 * @returns Stop function to halt the feed
 */
export function startMockFeed(
  callback: (intent: Intent) => void,
  intervalMs: number = 1000
): () => void {
  // Load intents on first start
  if (mockIntents.length === 0) {
    mockIntents = loadMockIntents();
  }

  if (mockIntents.length === 0) {
    logger.warn('No mock intents available. Feed will not emit any intents.');
    return () => {}; // noop stop function
  }

  const intervalId = setInterval(() => {
    if (mockIntents.length === 0) return;

    const intent = mockIntents[currentIndex];
    logger.debug(`Emitting mock intent: ${intent.id}`);
    callback(intent);

    currentIndex = (currentIndex + 1) % mockIntents.length;
  }, intervalMs);

  logger.info('Mock feed started');

  return () => {
    clearInterval(intervalId);
    logger.info('Mock feed stopped');
  };
}

/**
 * Get all loaded mock intents (for testing).
 */
export function getMockIntents(): Intent[] {
  if (mockIntents.length === 0) {
    mockIntents = loadMockIntents();
  }
  return mockIntents;
}
