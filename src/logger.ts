/**
 * src/logger.ts
 * PURPOSE: Centralized logging utility with timestamps and log levels.
 */

import * as winston from 'winston';
import { config } from './config';

const logger = winston.createLogger({
  level: config.LOG_LEVEL,
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
        winston.format.printf(({ level, message, timestamp }: any) => {
          return `${timestamp} [${level}] ${message}`;
        })
      ),
    }),
  ],
});

export default logger;