/**
 * src/models/intent.ts
 * PURPOSE: Define the Intent data model and validation helpers.
 * An intent represents a user's desire to swap tokens atomically.
 *
 * TODO: Add comprehensive validation using zod schema
 * TODO: Add serialization/deserialization helpers for DB and JSON
 */

/**
 * Intent: Represents a user's token swap intention.
 *
 * Fields:
 * - id: Unique identifier for the intent (e.g., hash or UUID)
 * - maker: Address that initiated the intent (will receive buyToken)
 * - sellToken: Token address to sell (ERC20)
 * - buyToken: Token address to buy (ERC20)
 * - sellAmount: Amount of sellToken to sell (in wei, BigInt)
 * - minBuyAmount: Minimum acceptable amount of buyToken to receive (in wei, BigInt)
 * - deadline: Block timestamp by which the intent must be fulfilled
 * - status: Current state (pending, matched, executing, executed, failed, cancelled)
 * - createdAt: Unix timestamp when intent was created
 * - signature: (Optional) The EIP-712 signature for the order
 */
export interface Intent {
  id: string;
  maker: string;
  sellToken: string;
  buyToken: string;
  sellAmount: bigint;
  minBuyAmount: bigint;
  deadline: number;
  status: 'pending' | 'matched' | 'executing' | 'executed' | 'failed' | 'cancelled';
  createdAt: number;
  signature?: string; // Added to match the orderbook listener
}

/**
 * Validate an intent for basic correctness.
 * Returns true if valid, throws error if invalid.
 *
 * TODO: Expand validation to include:
 * - Token contract existence check
 * - Maker balance verification (if on-chain)
 * - Deadline sanity checks
 * - Token address format validation (checksum, length)
 */
export function validateIntent(intent: Intent): boolean {
  if (!intent.id || intent.id.length === 0) {
    throw new Error('Intent must have a non-empty id');
  }
  if (!intent.maker || !intent.maker.startsWith('0x')) {
    throw new Error('Intent maker must be a valid Ethereum address');
  }
  if (!intent.sellToken || !intent.sellToken.startsWith('0x')) {
    throw new Error('Intent sellToken must be a valid Ethereum address');
  }
  if (!intent.buyToken || !intent.buyToken.startsWith('0x')) {
    throw new Error('Intent buyToken must be a valid Ethereum address');
  }
  if (intent.sellToken === intent.buyToken) {
    throw new Error('Intent sellToken and buyToken must be different');
  }
  if (intent.sellAmount <= 0n) {
    throw new Error('Intent sellAmount must be positive');
  }
  if (intent.minBuyAmount <= 0n) {
    throw new Error('Intent minBuyAmount must be positive');
  }
  if (intent.deadline <= Math.floor(Date.now() / 1000)) {
    throw new Error('Intent deadline must be in the future');
  }
  return true;
}

/**
 * Check if two intents are complementary (can be settled together).
 * Intents are complementary if:
 * - Intent A's sellToken == Intent B's buyToken
 * - Intent B's sellToken == Intent A's buyToken
 * (i.e., the tokens are swapped)
 */
export function areIntentsComplementary(intentA: Intent, intentB: Intent): boolean {
  return (
    intentA.sellToken.toLowerCase() === intentB.buyToken.toLowerCase() &&
    intentB.sellToken.toLowerCase() === intentA.buyToken.toLowerCase()
  );
}