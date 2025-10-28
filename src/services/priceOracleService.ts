/**
 * Price Oracle Service
 * 
 * Periodically fetches token prices from Chainlink and updates the planner cache.
 * This allows the planner to use real prices without being async.
 */

import { ethers } from 'ethers';
import { getMultipleTokenPrices } from '../utils/priceOracle.js';
import { updatePriceCache } from '../planner/planner.js';
import { TOKEN_ADDRESSES_OPTIMISM } from '../config/safety.js';
import logger from '../logger.js';

export class PriceOracleService {
  private provider: ethers.Provider;
  private updateInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(provider: ethers.Provider) {
    this.provider = provider;
  }

  /**
   * Start the price oracle service
   * @param intervalMs Update interval in milliseconds (default: 60000 = 1 minute)
   */
  start(intervalMs: number = 60000): void {
    if (this.isRunning) {
      logger.warn('[price-oracle] Service already running');
      return;
    }

    logger.info(`[price-oracle] Starting price oracle service (updates every ${intervalMs / 1000}s)`);
    this.isRunning = true;

    // Fetch prices immediately
    this.updatePrices();

    // Then fetch periodically
    this.updateInterval = setInterval(() => {
      this.updatePrices();
    }, intervalMs);
  }

  /**
   * Stop the price oracle service
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    logger.info('[price-oracle] Stopping price oracle service');
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    this.isRunning = false;
  }

  /**
   * Fetch and update prices for all tokens
   */
  private async updatePrices(): Promise<void> {
    try {
      logger.debug('[price-oracle] Fetching token prices from Chainlink...');

      const tokenAddresses = Object.values(TOKEN_ADDRESSES_OPTIMISM);
      const prices = await getMultipleTokenPrices(tokenAddresses, this.provider);

      if (prices.size === 0) {
        logger.warn('[price-oracle] No fresh prices available from Chainlink (all feeds may be stale)');
        return;
      }

      // Update planner cache with fresh prices
      let updateCount = 0;
      prices.forEach((price, address) => {
        updatePriceCache(address, price);
        updateCount++;
      });

      logger.info(`[price-oracle] ✓ Updated ${updateCount} token prices from Chainlink`);
      
      // Log prices for monitoring
      this.logPrices(prices);

    } catch (error: any) {
      // Suppress noisy errors - just log once at debug level
      logger.debug(`[price-oracle] Update failed: ${error.message}`);
      // Don't crash - keep using cached prices
    }
  }

  /**
   * Log current prices for monitoring
   */
  private logPrices(prices: Map<string, number>): void {
    const priceLog: string[] = [];
    
    prices.forEach((price, address) => {
      // Get token symbol from address
      const symbol = this.getTokenSymbol(address);
      priceLog.push(`${symbol}=$${price.toFixed(2)}`);
    });

    logger.debug(`[price-oracle] Prices: ${priceLog.join(', ')}`);
  }

  /**
   * Get token symbol from address (for logging)
   */
  private getTokenSymbol(address: string): string {
    const addr = address.toLowerCase();
    const mapping: Record<string, string> = {
      '0x4200000000000000000000000000000000000006': 'WETH',
      '0x0b2c639c533813f4aa9d7837caf62653d097ff85': 'USDC',
      '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58': 'USDT',
      '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 'DAI',
      '0x4200000000000000000000000000000000000042': 'OP',
      '0x68f180fcce6836688e9084f035309e29bf0a2095': 'WBTC',
    };
    return mapping[addr] || addr.slice(0, 10);
  }

  /**
   * Check if service is running
   */
  isActive(): boolean {
    return this.isRunning;
  }
}
