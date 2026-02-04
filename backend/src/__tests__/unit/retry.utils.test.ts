/**
 * Unit Tests: Retry Utils
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateBackoffDelay,
  withRetry,
  DEFAULT_RETRY_CONFIG,
  type RetryConfig,
} from '../../application/workers/retry.utils.js';

describe('Retry Utils', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  describe('calculateBackoffDelay', () => {
    it('should calculate exponential backoff', () => {
      const config: RetryConfig = { ...DEFAULT_RETRY_CONFIG, baseDelayMs: 100, jitterFactor: 0 };
      
      const delay0 = calculateBackoffDelay(0, config);
      const delay1 = calculateBackoffDelay(1, config);
      const delay2 = calculateBackoffDelay(2, config);
      
      // With jitter=0, delays should be exact: 100, 200, 400
      expect(delay0).toBe(100);
      expect(delay1).toBe(200);
      expect(delay2).toBe(400);
    });

    it('should add jitter to backoff', () => {
      const config: RetryConfig = { ...DEFAULT_RETRY_CONFIG, baseDelayMs: 100, jitterFactor: 0.3 };
      
      // Run multiple times to verify jitter adds variance
      const delays = new Set<number>();
      for (let i = 0; i < 20; i++) {
        delays.add(calculateBackoffDelay(1, config));
      }
      
      // With jitter, we should see some variance
      expect(delays.size).toBeGreaterThan(1);
    });

    it('should respect maxDelayMs cap', () => {
      const config: RetryConfig = { ...DEFAULT_RETRY_CONFIG, maxDelayMs: 500, jitterFactor: 0 };
      
      const delay = calculateBackoffDelay(10, config); // Very high attempt
      
      expect(delay).toBeLessThanOrEqual(500);
    });
  });

  describe('withRetry', () => {
    it('should return result on first success', async () => {
      const fn = vi.fn().mockResolvedValue('result');
      
      const result = await withRetry(fn, 'testOperation', DEFAULT_RETRY_CONFIG);
      
      expect(fn).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.result).toBe('result');
    });

    it('should retry on failure and eventually succeed', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValue('result');
      
      const config: RetryConfig = { ...DEFAULT_RETRY_CONFIG, baseDelayMs: 1, maxDelayMs: 10 };
      const result = await withRetry(fn, 'testOperation', config);
      
      expect(fn).toHaveBeenCalledTimes(3);
      expect(result.success).toBe(true);
      expect(result.result).toBe('result');
    });

    it('should return failure after max retries', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Always fails'));
      
      const config: RetryConfig = { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 10, jitterFactor: 0 };
      const result = await withRetry(fn, 'testOperation', config);
      
      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Always fails');
    });

    it('should track number of attempts', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockResolvedValue('result');
      
      const config: RetryConfig = { ...DEFAULT_RETRY_CONFIG, baseDelayMs: 1, maxDelayMs: 10 };
      const result = await withRetry(fn, 'testOperation', config);
      
      expect(result.attempts).toBe(2);
    });

    it('should handle non-Error rejections', async () => {
      const fn = vi.fn().mockRejectedValue('string error');
      
      const config: RetryConfig = { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 10, jitterFactor: 0 };
      const result = await withRetry(fn, 'testOperation', config);
      
      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('string error');
    });
  });
});
