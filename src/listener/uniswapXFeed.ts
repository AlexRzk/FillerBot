/**
 * src/listener/uniswapxFeed.ts
 * PURPOSE: Listen for real-time UniswapX orders from a webhook.
 */

import * as http from 'http';
import { Intent } from '../models/intent';
import logger from '../logger';
import { ethers } from 'ethers';

// As per the moksa-uniswapx-service README
interface UniswapXOrderPayload {
  orderHash: string;
  createdAt: number;
  signature: string;
  offerer: string;
  orderStatus: string;
  encodedOrder: string;
  chainId: number;
  quoteId?: string;
  filler?: string;
}

/**
 * Decodes the ABI-encoded order from the UniswapX webhook payload.
 * The encodedOrder is a tightly packed encoding of the order struct.
 * We need to decode it to get the individual fields.
 */
function decodeOrder(encodedOrder: string): Omit<Intent, 'id' | 'signature'> | null {
  try {
    // The order struct from the UniswapX contract
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
      status: 'pending',
      createdAt: Math.floor(Date.now() / 1000),
    };
  } catch (error) {
    logger.error(`Failed to decode order: ${error}`);
    return null;
  }
}


/**
 * Transforms a UniswapX webhook payload into the bot's internal Intent format.
 */
function payloadToIntent(payload: UniswapXOrderPayload): Intent | null {
  const decodedOrder = decodeOrder(payload.encodedOrder);
  if (!decodedOrder) {
    return null;
  }

  return {
    id: payload.orderHash,
    ...decodedOrder,
    signature: payload.signature,
  };
}

/**
 * Starts an HTTP server to listen for UniswapX order webhooks.
 */
export function startUniswapXListener(port: number, intentCallback: (intent: Intent) => void): void {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/webhook') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body) as UniswapXOrderPayload;
          logger.info(`Received UniswapX order: ${payload.orderHash}`);
          
          const intent = payloadToIntent(payload);
          if (intent) {
            intentCallback(intent);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'success' }));
        } catch (error) {
          logger.error(`Webhook processing error: ${error}`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: 'Invalid payload' }));
        }
      });
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: 'Not found' }));
    }
  });

  server.listen(port, () => {
    logger.info(`UniswapX webhook listener started on port ${port}`);
  });
}