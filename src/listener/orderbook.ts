
/**
 * src/listener/orderbook.ts
 * PURPOSE: Connect to a real-time orderbook feed via WebSocket.
 */

import WebSocket from 'ws';
import { Intent } from '../models/intent';
import logger from '../logger';
import { ethers } from 'ethers';

// This is a generic interface for an order from a data provider.
// The actual structure will depend on the chosen provider.
interface OrderbookData {
  orderHash: string;
  signature: string;
  encodedOrder: string;
  // other fields from the provider...
}

/**
 * Decodes the ABI-encoded order from the orderbook payload.
 */
function decodeOrder(encodedOrder: string): Omit<Intent, 'id' | 'signature' | 'status' | 'createdAt'> | null {
  try {
    const orderStruct = [
      'bytes32 info',
      'address inputToken',
      'address outputToken',
      'uint256 inputAmount',
      'uint256 minOutputAmount',
      'address swapper',
      'uint256 deadline',
      'uint256 fee'
    ];

    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(orderStruct, encodedOrder);

    return {
      maker: decoded.swapper,
      sellToken: decoded.inputToken,
      buyToken: decoded.outputToken,
      sellAmount: decoded.inputAmount,
      minBuyAmount: decoded.minOutputAmount,
      deadline: Number(decoded.deadline),
    };
  } catch (error) {
    logger.error(`Failed to decode order: ${error}`);
    return null;
  }
}

/**
 * Transforms an orderbook payload into the bot's internal Intent format.
 */
function dataToIntent(data: OrderbookData): Intent | null {
  const decodedOrder = decodeOrder(data.encodedOrder);
  if (!decodedOrder) {
    return null;
  }

  return {
    id: data.orderHash,
    ...decodedOrder,
    signature: data.signature,
    status: 'pending',
    createdAt: Math.floor(Date.now() / 1000),
  };
}

/**
 * Starts a WebSocket listener for a real-time orderbook feed.
 */
export function startOrderbookListener(
  apiKey: string,
  wsUrl: string,
  intentCallback: (intent: Intent) => void
): void {
  logger.info(`Connecting to orderbook WebSocket: ${wsUrl}`);

  const connect = () => {
    const ws = new WebSocket(wsUrl, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    ws.on('open', () => {
      logger.info('Connected to orderbook WebSocket.');
      // Subscription message might be needed depending on the provider
      // ws.send(JSON.stringify({ action: 'subscribe', channel: 'orders' }));
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const payload = JSON.parse(data.toString()) as OrderbookData;
        const intent = dataToIntent(payload);
        if (intent) {
          intentCallback(intent);
        }
      } catch (error) {
        logger.error(`Error processing orderbook message: ${error}`);
      }
    });

    ws.on('error', (error) => {
      logger.error(`Orderbook WebSocket error: ${error.message}`);
    });

    ws.on('close', (code, reason) => {
      logger.warn(`Orderbook WebSocket closed. Code: ${code}, Reason: ${reason}. Reconnecting in 5 seconds...`);
      setTimeout(connect, 5000);
    });
  };

  connect();
}
