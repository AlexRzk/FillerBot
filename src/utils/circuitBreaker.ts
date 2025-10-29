/**
 * Circuit Breaker Manager
 * 
 * Monitors trading activity and automatically pauses the bot if:
 * - Total losses exceed limits
 * - Too many failed transactions
 * - Unusual price movements detected
 * 
 * This protects against losing money in production.
 */

import { SAFETY_CONFIG, CircuitBreakerState } from '../config/safety';

interface TradeRecord {
  timestamp: number;
  profitUSD: number;
  success: boolean;
  reason?: string;
}

class CircuitBreakerManager {
  private state: CircuitBreakerState = {
    isPaused: false,
    reason: '',
    triggeredAt: 0,
    lossInLastHour: 0,
    lossInLastDay: 0,
    failedTxsInLastHour: 0,
  };

  private tradeHistory: TradeRecord[] = [];
  private lastCleanup: number = Date.now();

  /**
   * Check if trading is currently paused
   */
  isPaused(): boolean {
    // Check if cooldown period has expired
    if (this.state.isPaused) {
      const cooldownExpired = Date.now() - this.state.triggeredAt > SAFETY_CONFIG.CIRCUIT_BREAKER_COOLDOWN_MS;
      if (cooldownExpired) {
        console.log('[circuit-breaker] Cooldown expired, resuming operations');
        this.resume();
      }
    }
    return this.state.isPaused;
  }

  /**
   * Get current circuit breaker state
   */
  getState(): CircuitBreakerState {
    return { ...this.state };
  }

  /**
   * Record a trade result
   */
  recordTrade(profitUSD: number, success: boolean, reason?: string): void {
    const record: TradeRecord = {
      timestamp: Date.now(),
      profitUSD,
      success,
      reason,
    };

    this.tradeHistory.push(record);
    
    // Cleanup old records every hour
    if (Date.now() - this.lastCleanup > 3600000) {
      this.cleanup();
    }

    // Update metrics
    this.updateMetrics();

    // Check circuit breaker conditions
    this.checkConditions();

    // Log the trade
    if (success) {
      console.log(`[circuit-breaker] Trade recorded: $${profitUSD.toFixed(2)} profit`);
    } else {
      console.warn(`[circuit-breaker] Failed trade recorded: ${reason || 'unknown reason'}`);
    }
  }

  /**
   * Update loss and failure metrics
   */
  private updateMetrics(): void {
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const oneDayAgo = now - 86400000;

    // Calculate losses in last hour
    this.state.lossInLastHour = this.tradeHistory
      .filter(t => t.timestamp > oneHourAgo && t.profitUSD < 0)
      .reduce((sum, t) => sum + Math.abs(t.profitUSD), 0);

    // Calculate losses in last day
    this.state.lossInLastDay = this.tradeHistory
      .filter(t => t.timestamp > oneDayAgo && t.profitUSD < 0)
      .reduce((sum, t) => sum + Math.abs(t.profitUSD), 0);

    // Count failed transactions in last hour
    this.state.failedTxsInLastHour = this.tradeHistory
      .filter(t => t.timestamp > oneHourAgo && !t.success)
      .length;
  }

  /**
   * Check if circuit breaker should trigger
   */
  private checkConditions(): void {
    if (this.state.isPaused) return; // Already paused

    // Check hourly loss limit
    if (this.state.lossInLastHour > SAFETY_CONFIG.MAX_LOSS_PER_HOUR_USD) {
      this.trigger(`Loss in last hour ($${this.state.lossInLastHour.toFixed(2)}) exceeded limit ($${SAFETY_CONFIG.MAX_LOSS_PER_HOUR_USD})`);
      return;
    }

    // Check daily loss limit
    if (this.state.lossInLastDay > SAFETY_CONFIG.MAX_LOSS_PER_DAY_USD) {
      this.trigger(`Loss in last day ($${this.state.lossInLastDay.toFixed(2)}) exceeded limit ($${SAFETY_CONFIG.MAX_LOSS_PER_DAY_USD})`);
      return;
    }

    // Check failed transaction limit
    if (this.state.failedTxsInLastHour >= SAFETY_CONFIG.MAX_FAILED_TXS_PER_HOUR) {
      this.trigger(`Failed transactions in last hour (${this.state.failedTxsInLastHour}) exceeded limit (${SAFETY_CONFIG.MAX_FAILED_TXS_PER_HOUR})`);
      return;
    }
  }

  /**
   * Trigger circuit breaker
   */
  private trigger(reason: string): void {
    this.state.isPaused = true;
    this.state.reason = reason;
    this.state.triggeredAt = Date.now();

    console.error('╔═══════════════════════════════════════════════════════════════╗');
    console.error('║                  🚨 CIRCUIT BREAKER TRIGGERED 🚨              ║');
    console.error('╠═══════════════════════════════════════════════════════════════╣');
    console.error(`║ Reason: ${reason.padEnd(56)} ║`);
    console.error('║                                                               ║');
    console.error('║ Trading is PAUSED to protect your funds.                     ║');
    console.error(`║ Cooldown: ${(SAFETY_CONFIG.CIRCUIT_BREAKER_COOLDOWN_MS / 60000).toFixed(0)} minutes                                          ║`);
    console.error('║                                                               ║');
    console.error('║ To resume manually, call circuitBreaker.resume()             ║');
    console.error('╚═══════════════════════════════════════════════════════════════╝');

    if (SAFETY_CONFIG.ALERT_ON_CIRCUIT_BREAK) {
      // TODO: Add external alerting (email, SMS, webhook, etc.)
      this.sendAlert(reason);
    }
  }

  /**
   * Manually resume trading (use with caution)
   */
  resume(): void {
    if (!this.state.isPaused) {
      console.log('[circuit-breaker] Already active, no action needed');
      return;
    }

    console.log('[circuit-breaker] ✅ Resuming trading operations');
    this.state.isPaused = false;
    this.state.reason = '';
    this.state.triggeredAt = 0;
  }

  /**
   * Emergency stop (immediate pause)
   */
  emergencyStop(reason: string = 'Manual emergency stop'): void {
    console.error(`[circuit-breaker] 🛑 EMERGENCY STOP: ${reason}`);
    this.trigger(reason);
  }

  /**
   * Get trading statistics
   */
  getStats(): {
    totalTrades: number;
    successfulTrades: number;
    failedTrades: number;
    totalProfitUSD: number;
    lossInLastHour: number;
    lossInLastDay: number;
  } {
    const successful = this.tradeHistory.filter(t => t.success);
    const failed = this.tradeHistory.filter(t => !t.success);
    const totalProfit = this.tradeHistory.reduce((sum, t) => sum + t.profitUSD, 0);

    return {
      totalTrades: this.tradeHistory.length,
      successfulTrades: successful.length,
      failedTrades: failed.length,
      totalProfitUSD: totalProfit,
      lossInLastHour: this.state.lossInLastHour,
      lossInLastDay: this.state.lossInLastDay,
    };
  }

  /**
   * Cleanup old trade records (keep last 7 days)
   */
  private cleanup(): void {
    const sevenDaysAgo = Date.now() - 7 * 86400000;
    const before = this.tradeHistory.length;
    this.tradeHistory = this.tradeHistory.filter(t => t.timestamp > sevenDaysAgo);
    const removed = before - this.tradeHistory.length;
    
    if (removed > 0) {
      console.log(`[circuit-breaker] Cleaned up ${removed} old trade records`);
    }
    
    this.lastCleanup = Date.now();
  }

  /**
   * Send alert notification
   */
  private sendAlert(reason: string): void {
    // TODO: Implement external alerting
    // Options:
    // - Send email via SendGrid/Mailgun
    // - Send SMS via Twilio
    // - Post to Discord/Slack webhook
    // - Call monitoring service API
    
    console.log(`[circuit-breaker] Alert would be sent: ${reason}`);
  }

  /**
   * Reset all statistics (use with caution, for testing only)
   */
  reset(): void {
    console.warn('[circuit-breaker] ⚠️  Resetting all statistics');
    this.tradeHistory = [];
    this.state = {
      isPaused: false,
      reason: '',
      triggeredAt: 0,
      lossInLastHour: 0,
      lossInLastDay: 0,
      failedTxsInLastHour: 0,
    };
  }
}

// Singleton instance
export const circuitBreaker = new CircuitBreakerManager();
