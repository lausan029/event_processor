/**
 * Retry Utilities with Exponential Backoff + Jitter
 * Following project rules for fault tolerance
 */

import { createLogger } from '../../infrastructure/logging/logger.js';

const logger = createLogger('retry-utils');

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;  // 0-1, amount of randomness to add
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 5000,
  jitterFactor: 0.3,
};

/**
 * Calculate delay with exponential backoff and jitter
 * Formula: min(maxDelay, baseDelay * 2^attempt) * (1 + random * jitter)
 */
export function calculateBackoffDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  // Exponential backoff
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  
  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
  
  // Add jitter (randomness to prevent thundering herd)
  const jitter = 1 + (Math.random() * config.jitterFactor * 2 - config.jitterFactor);
  
  return Math.round(cappedDelay * jitter);
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
}

/**
 * Execute function with retries
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<RetryResult<T>> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const result = await operation();
      
      if (attempt > 0) {
        logger.info({
          operation: operationName,
          attempts: attempt + 1
        }, 'Operation succeeded after retry');
      }

      return { success: true, result, attempts: attempt + 1 };

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < config.maxRetries) {
        const delay = calculateBackoffDelay(attempt, config);
        
        logger.warn({
          operation: operationName,
          attempt: attempt + 1,
          maxRetries: config.maxRetries,
          nextRetryDelayMs: delay,
          error: lastError.message
        }, 'Operation failed, retrying...');

        await sleep(delay);
      }
    }
  }

  logger.error({
    operation: operationName,
    attempts: config.maxRetries + 1,
    error: lastError?.message
  }, 'Operation failed after all retries');

  const result: RetryResult<T> = { 
    success: false, 
    attempts: config.maxRetries + 1 
  };
  
  if (lastError) {
    result.error = lastError;
  }
  
  return result;
}
