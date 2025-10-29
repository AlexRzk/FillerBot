/**
 * src/listener/mockFeed.ts
 * PURPOSE: Generate synthetic intents from a mock JSON file for local testing.
 */

import * as fs from 'fs';
import { Intent } from '../models/intent';
import logger from '../logger';
import { config } from '../config';

let mockIntents: Intent[] = [];
let currentIndex = 0;

function loadMockIntents(): Intent[] {
  try {
    const filePath = config.MOCK_FEED_FILE;
    if (!fs.existsSync(filePath)) {
      logger.warn(`Mock intents file not found: ${filePath}`);
      return [];
    }

    const data = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(data);

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

export function startMockFeed(
  callback: (intent: Intent) => void,
  intervalMs: number = 1000
): () => void {
  if (mockIntents.length === 0) {
    mockIntents = loadMockIntents();
  }

  if (mockIntents.length === 0) {
    logger.warn('No mock intents available. Feed will not emit any intents.');
    return () => {};
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

export function getMockIntents(): Intent[] {
  if (mockIntents.length === 0) {
    mockIntents = loadMockIntents();
  }
  return mockIntents;
}