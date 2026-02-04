/**
 * Structured JSON logging with Pino.js
 * Following project rules for observability
 * 
 * Production: JSON format for Railway Logs indexing
 * Development: Pretty-printed for readability
 */

import pinoLib from 'pino';
import type { Logger as PinoLogger, LoggerOptions } from 'pino';

const isDevelopment = process.env['NODE_ENV'] !== 'production';
const isTest = process.env['NODE_ENV'] === 'test';

// Handle ESM default export
const pino = pinoLib.default ?? pinoLib;

// Railway metadata
const railwayEnv = process.env['RAILWAY_ENVIRONMENT'];
const railwayService = process.env['RAILWAY_SERVICE_NAME'];
const railwayReplicaId = process.env['RAILWAY_REPLICA_ID'];

// Build options conditionally to avoid undefined values with exactOptionalPropertyTypes
const loggerOptions: LoggerOptions = {
  level: isTest ? 'silent' : (process.env['LOG_LEVEL'] ?? 'info'),
  formatters: {
    level: (label: string) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Add base context for all logs
  base: {
    env: process.env['NODE_ENV'] ?? 'development',
    ...(railwayEnv && { railwayEnv }),
    ...(railwayService && { service: railwayService }),
    ...(railwayReplicaId && { replicaId: railwayReplicaId }),
  },
};

// Only add transport in development (not in production for JSON format)
if (isDevelopment && !isTest) {
  loggerOptions.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  };
}

const baseLogger = pino(loggerOptions);

export type Logger = PinoLogger;

export function createLogger(module: string): Logger {
  return baseLogger.child({ module });
}

export { baseLogger as logger };
