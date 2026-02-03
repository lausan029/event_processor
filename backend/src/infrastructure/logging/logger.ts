/**
 * Structured JSON logging with Pino.js
 * Following project rules for observability
 */

import pinoLib from 'pino';
import type { Logger as PinoLogger, LoggerOptions } from 'pino';

const isDevelopment = process.env['NODE_ENV'] !== 'production';

// Handle ESM default export
const pino = pinoLib.default ?? pinoLib;

// Build options conditionally to avoid undefined values with exactOptionalPropertyTypes
const loggerOptions: LoggerOptions = {
  level: process.env['LOG_LEVEL'] ?? 'info',
  formatters: {
    level: (label: string) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

// Only add transport in development
if (isDevelopment) {
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
