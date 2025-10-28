/**
 * src/logger.ts
 * PURPOSE: Centralized logging utility with timestamps and log levels.
 * Integrates with Winston for production logging.
 * 
 * TODO: Hook to external observability (Datadog, Sentry, CloudWatch)
 * TODO: Add structured logging with context objects
 */

import * as winston from 'winston';
import { config } from './config';

const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'intent-solver' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ..._meta }: any) => {
          return `${timestamp} [${level}] ${message}`;
        })
      ),
    }),
    // TODO: Add file transport for persistent logs
    // new winston.transports.File({ filename: './logs/error.log', level: 'error' }),
    // new winston.transports.File({ filename: './logs/combined.log' }),
  ],
});

export default logger;
