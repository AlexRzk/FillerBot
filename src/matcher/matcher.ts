/**
 * src/matcher/matcher.ts
 * PURPOSE: Find complementary intent pairs that can be settled together.
 * Implements the core matching logic for the filler bot.
 * 
 * MATCHING ALGORITHM:
 * Two intents are complementary if:
 * - Intent A sells Token X and buys Token Y
 * - Intent B sells Token Y and buys Token X
 * (The token pairs are swapped)
 * 
 * TODO: Implement partial matching (when amounts don't fully align)
 * TODO: Implement multi-leg matching (n-way swaps)
 * TODO: Add scoring/ranking system for best execution
 * TODO: Add gas cost consideration in matching
 */

import { Intent } from '../models/intent';
import logger from '../logger';

import { config } from '../config';

/**
 * Candidate pair ready for simulation and settlement.
 */
export interface Candidate {
  // First intent (sells Token A, buys Token B)
  intentA: Intent;

  // Second intent (sells Token B, buys Token A)
  intentB: Intent;

  // Overlap ratio: how well the amounts align
  overlapRatio: number;

  // Scoring metric for ranking candidates
  score: number;

  // AMM address for this pair
  ammAddress: string;
}

/**
 * Find all complementary intent pairs from a list of intents.
 * Returns candidates sorted by score (highest first).
 * 
 * @param intents List of intents to match
 * @returns Array of candidate pairs, sorted by score
 */
export function findCandidates(intents: Intent[]): Candidate[] {
  const candidates: Candidate[] = [];
  const intentMap: Map<string, Intent[]> = new Map();

  // Populate the hash map
  for (const intent of intents) {
    if (intent.status !== 'pending') {
      continue;
    }
    const key = `${intent.sellToken}/${intent.buyToken}`;
    if (!intentMap.has(key)) {
      intentMap.set(key, []);
    }
    intentMap.get(key)!.push(intent);
  }

  // Find complementary intents
  for (const [key, intentsA] of intentMap.entries()) {
    const [sellToken, buyToken] = key.split('/');
    const complementaryKey = `${buyToken}/${sellToken}`;

    if (intentMap.has(complementaryKey)) {
      const intentsB = intentMap.get(complementaryKey)!;
      const ammAddress = config.amms[key] || config.amms[complementaryKey];

      if (!ammAddress) {
        continue;
      }

      for (const intentA of intentsA) {
        for (const intentB of intentsB) {
          // Check deadline: both intents must have sufficient time
          const now = Math.floor(Date.now() / 1000);
          if (intentA.deadline <= now || intentB.deadline <= now) {
            logger.debug('Skipping intents with expired deadlines');
            continue;
          }

          // Calculate overlap ratio
          const overlapA = calculateOverlap(intentA.sellAmount, intentB.minBuyAmount);
          const overlapB = calculateOverlap(intentB.sellAmount, intentA.minBuyAmount);
          const overlapRatio = Math.min(overlapA, overlapB);

          const score = computeScore(intentA, intentB, overlapRatio);

          candidates.push({
            intentA,
            intentB,
            overlapRatio,
            score,
            ammAddress,
          });

          logger.debug(
            `Found candidate pair: ${intentA.id} <-> ${intentB.id} (overlap: ${overlapRatio.toFixed(2)}, score: ${score.toFixed(2)})`
          );
        }
      }
    }
  }

  // Sort by score (highest first)
  candidates.sort((a, b) => b.score - a.score);

  return candidates;
}

/**
 * Calculate overlap between two amounts.
 * Returns a value between 0 and 1, where 1 is perfect match.
 * 
 * overlap = min(amount1, amount2) / max(amount1, amount2)
 * 
 * This is a simple heuristic; real matching would involve price/exchange rates.
 */
function calculateOverlap(amount1: bigint, amount2: bigint): number {
  if (amount1 === 0n || amount2 === 0n) return 0;

  const min = amount1 < amount2 ? amount1 : amount2;
  const max = amount1 > amount2 ? amount1 : amount2;

  return Number(min) / Number(max);
}

/**
 * Compute a score for a candidate pair.
 * Higher score = better candidate.
 * 
 * TODO: Expand scoring to include:
 * - Price impact (how much does execution change reserves?)
 * - Time until expiry (sooner deadline = higher priority)
 * - Historical reliability of maker
 * - Potential MEV exposure
 * 
 * For now, using a simple formula:
 * score = overlapRatio * (1 / distanceToExpiry)
 */
function computeScore(intentA: Intent, intentB: Intent, overlapRatio: number): number {
  const now = Math.floor(Date.now() / 1000);

  // Get minimum time to expiry
  const timeA = Math.max(intentA.deadline - now, 1); // Min 1 second
  const timeB = Math.max(intentB.deadline - now, 1);
  const minTime = Math.min(timeA, timeB);

  // Score: overlap * urgency
  // Intents with sooner deadlines get higher scores
  const urgency = 1 / minTime; // Closer to expiry -> higher urgency
  return overlapRatio * Math.log(urgency + 1);
}

/**
 * Get the top N candidates by score.
 */
export function getTopCandidates(intents: Intent[], topN: number = 1): Candidate[] {
  const candidates = findCandidates(intents);
  return candidates.slice(0, topN);
}
