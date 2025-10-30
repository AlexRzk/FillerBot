/**
 * src/utils/cow.ts
 * PURPOSE: CoW Protocol order conversion utilities.
 */

import { Intent } from '../models/intent';

export function convertCowOrderToIntent(order: any): Intent {
  return {
    id: order.uid,
    maker: order.owner,
    sellToken: order.sellToken.toLowerCase(),
    buyToken: order.buyToken.toLowerCase(),
    sellAmount: BigInt(order.sellAmount),
    minBuyAmount: BigInt(order.buyAmount),
    deadline: order.validTo,
    status: 'pending',
    createdAt: Math.floor(Date.now() / 1000),
  };
}