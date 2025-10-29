/**
 * UniswapX Intent Feed for Base Mainnet
 * 
 * UniswapX is Uniswap's cross-chain intent protocol using Dutch auctions.
 * This module fetches pending UniswapX orders on Base.
 * 
 * Key concepts:
 * - Dutch auction: price improves over time until filled
 * - Exclusive filler: some orders have exclusive windows
 * - Multiple reactors: V1, V2, priority orders
 * 
 * Base deployment:
 * - Reactor contract: monitors for Open orders
 * - API endpoint (if available): query pending orders
 * - Event logs: OrderOpen events from reactor
 */

import { ethers } from 'ethers';
import { Intent } from '../models/intent';

// UniswapX Reactor addresses on Base
// Source: https://docs.uniswap.org/contracts/uniswapx/fillers/priority/priorityorderreactor
// Base uses Priority Order Reactor (PGA - Priority Gas Auction)
// NOT the V2 Dutch Auction reactor!
// NOTE: Now deprecated in favor of pendingOrdersListener.ts for real-time pending orders
// const UNISWAPX_PRIORITY_REACTOR_BASE = '0x000000001Ec5656dcdB24D90DFa42742738De729';

// For comparison: V2 reactor exists but is NOT used on Base
// const UNISWAPX_V2_REACTOR_BASE = '0x6000da47483062A0D734Ba3dc7576Ce6A0B645C4';

// UniswapX order API - may use Uniswap Labs API or need direct event monitoring
// Note: Public API may not be available; might need to use The Graph or direct RPC
const UNISWAPX_API_BASE = 'https://api.uniswap.org/v2/orders'; // Check if this exists

interface UniswapXOrder {
  orderHash: string;
  chainId: number;
  swapper: string; // Order creator
  nonce: string;
  deadline: number;
  reactor: string;
  input: {
    token: string;
    amount: string;
    startAmount?: string; // Dutch auction start
    endAmount?: string; // Dutch auction end
  };
  outputs: Array<{
    token: string;
    amount: string;
    startAmount?: string;
    endAmount?: string;
    recipient: string;
  }>;
  exclusiveFiller?: string;
  exclusivityDeadline?: number;
  decayStartTime?: number;
  decayEndTime?: number;
}

/**
 * Fetch pending UniswapX orders from Base mainnet
 * 
 * Strategies (in priority order):
 * 1. UniswapX API (if available for Base)
 * 2. The Graph subgraph for UniswapX on Base
 * 3. Direct RPC: query OrderOpen events from reactor contract
 * 
 * @param provider ethers provider connected to Base mainnet
 * @returns Array of Intent objects parsed from UniswapX orders
 */
export async function fetchUniswapXOrders(provider: ethers.Provider): Promise<Intent[]> {
  console.log('[info] Fetching UniswapX orders from Base mainnet...');

  try {
    // Strategy 1: Try API endpoint (if exists for Optimism)
    const apiOrders = await fetchFromUniswapXAPI();
    if (apiOrders.length > 0) {
      console.log(`[info] ✓ Found ${apiOrders.length} UniswapX orders from API`);
      return apiOrders;
    }

    // Strategy 2: Try The Graph subgraph
    const subgraphOrders = await fetchFromUniswapXSubgraph();
    if (subgraphOrders.length > 0) {
      console.log(`[info] ✓ Found ${subgraphOrders.length} UniswapX orders from subgraph`);
      return subgraphOrders;
    }

    // Strategy 3: Query reactor contract events directly
    const eventOrders = await fetchFromReactorEvents(provider);
    if (eventOrders.length > 0) {
      console.log(`[info] ✓ Found ${eventOrders.length} UniswapX orders from events`);
      return eventOrders;
    }

    console.log('[warn] No UniswapX orders found on Base mainnet');
    return [];

  } catch (error: any) {
    console.error('[error] UniswapX feed error:', error.message);
    return [];
  }
}

/**
 * Strategy 1: Fetch from UniswapX API
 * 
 * Base uses Priority Order Reactor with PGA (Priority Gas Auctions)
 * API: GET https://api.uniswap.org/v2/orders?orderStatus=open&orderType=Priority&chainId=8453
 */
async function fetchFromUniswapXAPI(): Promise<Intent[]> {
  try {
    // Base uses Priority orders, not Dutch auction
    const endpoint = `${UNISWAPX_API_BASE}/orders?chainId=8453&orderStatus=open&orderType=Priority`;
    
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'IntentFillerBot/1.0',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log('[info] UniswapX API not available for Base Priority orders');
        return [];
      }
      console.warn(`[warn] UniswapX API returned status ${response.status}`);
      return [];
    }

    const data = await response.json();
    const orders = (data as any).orders || (data as any).data || [];

    return orders
      .filter((order: any) => order.chainId === 10) // Optimism only
      .map((order: any) => parseUniswapXOrder(order));

  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.log('[warn] UniswapX API request timeout');
    } else {
      console.log('[info] UniswapX API not accessible:', error.message);
    }
    return [];
  }
}

/**
 * Strategy 2: Fetch from The Graph subgraph
 * 
 * Query for recent OrderOpen events that haven't been filled.
 * Subgraph endpoint format: https://api.thegraph.com/subgraphs/name/uniswap/uniswapx-optimism
 */
async function fetchFromUniswapXSubgraph(): Promise<Intent[]> {
  try {
    // Example subgraph endpoint - verify actual deployment
    const endpoint = 'https://api.thegraph.com/subgraphs/name/uniswap/uniswapx-v2';
    
    const query = `
      query PendingOrders {
        orders(
          first: 50
          where: { 
            chainId: 10
            status: "open"
            deadline_gt: ${Math.floor(Date.now() / 1000)}
          }
          orderBy: createdAt
          orderDirection: desc
        ) {
          orderHash
          swapper
          nonce
          deadline
          reactor
          inputToken
          inputAmount
          outputToken
          outputAmount
          outputRecipient
          exclusiveFiller
          exclusivityDeadline
          decayStartTime
          decayEndTime
        }
      }
    `;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      console.log(`[info] UniswapX subgraph returned status ${response.status}`);
      return [];
    }

    const result = await response.json();
    
    if ((result as any).errors) {
      console.log('[info] UniswapX subgraph error:', (result as any).errors[0]?.message);
      return [];
    }

    const orders = (result as any).data?.orders || [];
    return orders.map((order: any) => parseSubgraphOrder(order));

  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.log('[warn] UniswapX subgraph request timeout');
    } else {
      console.log('[info] UniswapX subgraph not accessible:', error.message);
    }
    return [];
  }
}

/**
 * Strategy 3: Query reactor contract events directly
 * 
 * DEPRECATED: This now only fetches historical FILLED orders (too late to fill).
 * Use pendingOrdersListener.ts instead to get PENDING/UNFILLED orders.
 * 
 * Listen to Fill events from the UniswapX Priority Order Reactor.
 * Note: These are COMPLETED orders only (after they're filled by someone else).
 */
async function fetchFromReactorEvents(_provider: ethers.Provider): Promise<Intent[]> {
  try {
    // DEPRECATED: This only shows past filled orders
    // Use pendingOrdersListener.ts for real-time PENDING orders instead
    return [];
  } catch (error: any) {
    console.log('[info] UniswapX event query failed:', error.message);
    return [];
  }
}

/**
 * Parse UniswapX order from API response to Intent model
 * 
 * Note: Intent model doesn't have source/metadata fields yet.
 * Additional UniswapX-specific data (exclusivity, decay) is encoded in the ID
 * for now. TODO: Extend Intent model with optional metadata field.
 */
function parseUniswapXOrder(order: UniswapXOrder): Intent {
  const now = Math.floor(Date.now() / 1000);

  // Handle Dutch auction decay
  // If order has decay, calculate current price based on time
  let currentInputAmount = order.input.amount;
  let currentOutputAmount = order.outputs[0].amount;

  if (order.decayStartTime && order.decayEndTime && 
      order.input.startAmount && order.input.endAmount) {
    // Linear decay formula
    const elapsed = now - order.decayStartTime;
    const duration = order.decayEndTime - order.decayStartTime;
    const progress = Math.min(1, elapsed / duration);

    const startInput = BigInt(order.input.startAmount);
    const endInput = BigInt(order.input.endAmount);
    const decayRange = endInput - startInput;
    currentInputAmount = (startInput + (decayRange * BigInt(Math.floor(progress * 1000)) / 1000n)).toString();

    if (order.outputs[0].startAmount && order.outputs[0].endAmount) {
      const startOutput = BigInt(order.outputs[0].startAmount);
      const endOutput = BigInt(order.outputs[0].endAmount);
      const outputDecayRange = endOutput - startOutput;
      currentOutputAmount = (startOutput + (outputDecayRange * BigInt(Math.floor(progress * 1000)) / 1000n)).toString();
    }
  }

  // Check if order is in exclusive filler window
  const isExclusive = order.exclusiveFiller && 
                      order.exclusivityDeadline && 
                      now < order.exclusivityDeadline;

  // Encode UniswapX-specific metadata in ID for now
  // Format: uniswapx:{orderHash}:exclusive={bool}:exclusivityDeadline={timestamp}
  const idSuffix = isExclusive ? `:exclusive=${order.exclusivityDeadline}` : '';
  const intentId = `uniswapx:${order.orderHash}${idSuffix}`;

  return {
    id: intentId,
    maker: order.swapper,
    sellToken: order.input.token.toLowerCase(),
    buyToken: order.outputs[0].token.toLowerCase(),
    sellAmount: BigInt(currentInputAmount),
    minBuyAmount: BigInt(currentOutputAmount),
    deadline: order.deadline,
    status: 'pending',
    createdAt: now,
  };
}

/**
 * Parse subgraph order to Intent model
 * 
 * Similar to API parsing, encodes exclusivity info in ID.
 */
function parseSubgraphOrder(order: any): Intent {
  const now = Math.floor(Date.now() / 1000);
  const isExclusive = order.exclusiveFiller && 
                      order.exclusivityDeadline && 
                      now < order.exclusivityDeadline;

  const idSuffix = isExclusive ? `:exclusive=${order.exclusivityDeadline}` : '';
  const intentId = `uniswapx:${order.orderHash}${idSuffix}`;

  return {
    id: intentId,
    maker: order.swapper,
    sellToken: order.inputToken.toLowerCase(),
    buyToken: order.outputToken.toLowerCase(),
    sellAmount: BigInt(order.inputAmount),
    minBuyAmount: BigInt(order.outputAmount),
    deadline: order.deadline,
    status: 'pending',
    createdAt: now,
  };
}

/**
 * Check if we can fill a UniswapX order (not in exclusive window)
 * 
 * Parses exclusivity info from the intent ID.
 * Format: uniswapx:{orderHash}:exclusive={deadline}
 */
export function canFillUniswapXOrder(intent: Intent): boolean {
  // Only check UniswapX orders (ID starts with "uniswapx:")
  if (!intent.id.startsWith('uniswapx:')) return true;

  const now = Math.floor(Date.now() / 1000);

  // Parse exclusivity from ID
  const exclusiveMatch = intent.id.match(/:exclusive=(\d+)/);
  if (exclusiveMatch) {
    const exclusivityDeadline = parseInt(exclusiveMatch[1]);
    if (now < exclusivityDeadline) {
      console.log(`[info] Order ${intent.id.slice(0, 30)}... is in exclusive window until ${exclusivityDeadline}`);
      return false;
    }
  }

  return true;
}
