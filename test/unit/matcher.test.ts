/**
 * test/unit/matcher.test.ts
 * PURPOSE: Unit tests for the intent matching algorithm.
 * Tests pairing logic with synthetic intents.
 * 
 * TESTS:
 * - Finding complementary intent pairs
 * - Overlap ratio calculation
 * - Candidate scoring
 * - Edge cases (expired intents, invalid pairs)
 */

import { Intent } from '../../src/models/intent';
import { findCandidates, getTopCandidates } from '../../src/matcher/matcher';

describe('Matcher', () => {
  // Create test intents
  const createIntent = (
    id: string,
    sellToken: string,
    buyToken: string,
    sellAmount: bigint,
    minBuyAmount: bigint,
    status: 'pending' | 'executed' = 'pending'
  ): Intent => ({
    id,
    maker: `0x${'0'.repeat(40)}`,
    sellToken: sellToken.toLowerCase(),
    buyToken: buyToken.toLowerCase(),
    sellAmount,
    minBuyAmount,
    deadline: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    status,
    createdAt: Math.floor(Date.now() / 1000),
  });

  describe('findCandidates', () => {
    it('should find complementary intent pairs', () => {
      // Intent A: sells USDC, buys ETH
      const intentA = createIntent(
        'intent-1',
        '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // USDC
        '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', // ETH
        1000n * 10n ** 6n, // 1000 USDC
        1n * 10n ** 18n // 1 ETH
      );

      // Intent B: sells ETH, buys USDC (opposite of A)
      const intentB = createIntent(
        'intent-2',
        '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', // ETH
        '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // USDC
        1n * 10n ** 18n, // 1 ETH
        1000n * 10n ** 6n // 1000 USDC
      );

      const candidates = findCandidates([intentA, intentB]);

      expect(candidates.length).toBe(1);
      expect(candidates[0].intentA.id).toBe('intent-1');
      expect(candidates[0].intentB.id).toBe('intent-2');
    });

    it('should not match non-complementary pairs', () => {
      // Both intents buy the same token
      const intentA = createIntent(
        'intent-1',
        '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        1000n * 10n ** 18n,
        500n * 10n ** 18n
      );

      const intentB = createIntent(
        'intent-2',
        '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
        '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        1000n * 10n ** 18n,
        500n * 10n ** 18n
      );

      const candidates = findCandidates([intentA, intentB]);
      expect(candidates.length).toBe(0);
    });

    it('should ignore expired intents', () => {
      const pastTime = Math.floor(Date.now() / 1000) - 100;

      const intentA = createIntent(
        'intent-1',
        '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        1000n * 10n ** 18n,
        500n * 10n ** 18n
      );
      intentA.deadline = pastTime;

      const intentB = createIntent(
        'intent-2',
        '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        500n * 10n ** 18n,
        1000n * 10n ** 18n
      );

      const candidates = findCandidates([intentA, intentB]);
      expect(candidates.length).toBe(0);
    });

    it('should ignore non-pending intents', () => {
      const intentA = createIntent(
        'intent-1',
        '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        1000n * 10n ** 18n,
        500n * 10n ** 18n,
        'executed'
      );

      const intentB = createIntent(
        'intent-2',
        '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        500n * 10n ** 18n,
        1000n * 10n ** 18n
      );

      const candidates = findCandidates([intentA, intentB]);
      expect(candidates.length).toBe(0);
    });

    it('should rank candidates by score', () => {
      const now = Math.floor(Date.now() / 1000);

      // Pair 1: both expire soon (higher urgency = higher score)
      const pair1_a = createIntent(
        'pair1-a',
        '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        1000n * 10n ** 18n,
        1000n * 10n ** 18n
      );
      pair1_a.deadline = now + 100; // Expires soon

      const pair1_b = createIntent(
        'pair1-b',
        '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        1000n * 10n ** 18n,
        1000n * 10n ** 18n
      );
      pair1_b.deadline = now + 100;

      // Pair 2: both expire later (lower urgency = lower score)
      const pair2_a = createIntent(
        'pair2-a',
        '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
        '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
        1000n * 10n ** 18n,
        1000n * 10n ** 18n
      );
      pair2_a.deadline = now + 10000; // Expires later

      const pair2_b = createIntent(
        'pair2-b',
        '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
        '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
        1000n * 10n ** 18n,
        1000n * 10n ** 18n
      );
      pair2_b.deadline = now + 10000;

      const candidates = findCandidates([pair1_a, pair1_b, pair2_a, pair2_b]);

      expect(candidates.length).toBe(2);
      // Pair 1 should have higher score (sooner deadline = higher urgency)
      expect(candidates[0].score).toBeGreaterThan(candidates[1].score);
    });
  });

  describe('getTopCandidates', () => {
    it('should return top N candidates', () => {
      const intentA1 = createIntent(
        'a1',
        '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        1000n * 10n ** 18n,
        1000n * 10n ** 18n
      );
      const intentB1 = createIntent(
        'b1',
        '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        1000n * 10n ** 18n,
        1000n * 10n ** 18n
      );

      const intentA2 = createIntent(
        'a2',
        '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
        '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
        1000n * 10n ** 18n,
        1000n * 10n ** 18n
      );
      const intentB2 = createIntent(
        'b2',
        '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
        '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
        1000n * 10n ** 18n,
        1000n * 10n ** 18n
      );

      const topN = getTopCandidates([intentA1, intentB1, intentA2, intentB2], 1);

      expect(topN.length).toBe(1);
      expect(topN[0].intentA.id).toBeDefined();
      expect(topN[0].intentB.id).toBeDefined();
    });
  });
});
