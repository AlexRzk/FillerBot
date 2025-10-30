/**
 * src/utils/retry.ts
 * PURPOSE: Generic retry logic with exponential backoff.
 */

import logger from '../logger';

export async function retry<T>(fn: () => Promise<T>, retries: number, delay: number): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      logger.warn(`Attempt ${i + 1} failed. Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
  throw lastError;
}