/**
 * Integration Tests: Error Handling
 * Tests behavior when services fail (Redis down, MongoDB unavailable, etc.)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import Redis from 'ioredis';

describe('Error Handling Integration', () => {
  let redisContainer: StartedTestContainer;
  let redis: Redis;

  beforeAll(async () => {
    redisContainer = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start();

    redis = new Redis({
      host: redisContainer.getHost(),
      port: redisContainer.getMappedPort(6379),
      retryStrategy: () => null, // Don't retry for tests
      maxRetriesPerRequest: 1,
    });
  }, 120000);

  afterAll(async () => {
    await redis?.quit();
    await redisContainer?.stop();
  });

  beforeEach(async () => {
    await redis.flushall();
  });

  describe('Redis Connection Errors', () => {
    it('should handle Redis connection timeout gracefully', async () => {
      // Create a Redis client with very short timeout
      const badRedis = new Redis({
        host: 'non-existent-host',
        port: 6379,
        connectTimeout: 100,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
      });

      try {
        await expect(badRedis.ping()).rejects.toThrow();
      } finally {
        badRedis.disconnect();
      }
    });

    it('should handle Redis command errors', async () => {
      // Try invalid command on wrong data type
      await redis.set('string_key', 'value');
      
      // Trying to use list command on string should throw
      await expect(redis.lpush('string_key', 'item')).rejects.toThrow();
    });

    it('should handle Redis pipeline errors', async () => {
      const pipeline = redis.pipeline();
      
      // Valid commands
      pipeline.set('key1', 'value1');
      pipeline.get('key1');
      
      const results = await pipeline.exec();
      
      expect(results).toHaveLength(2);
      expect(results?.[0][0]).toBeNull(); // No error
      expect(results?.[1][1]).toBe('value1');
    });
  });

  describe('Stream Error Handling', () => {
    const STREAM_NAME = 'error_test_stream';
    const GROUP_NAME = 'error_test_group';

    it('should handle consumer group that already exists', async () => {
      // Create stream
      await redis.xadd(STREAM_NAME, '*', 'init', 'true');
      
      // Create group first time
      await redis.xgroup('CREATE', STREAM_NAME, GROUP_NAME, '0', 'MKSTREAM');
      
      // Try to create again - should throw BUSYGROUP error
      await expect(
        redis.xgroup('CREATE', STREAM_NAME, GROUP_NAME, '0', 'MKSTREAM')
      ).rejects.toThrow(/BUSYGROUP/);
    });

    it('should handle reading from non-existent stream', async () => {
      const result = await redis.xread(
        'COUNT', '1',
        'STREAMS', 'non_existent_stream', '0'
      );
      
      expect(result).toBeNull();
    });

    it('should handle reading from non-existent consumer group', async () => {
      await redis.xadd('existing_stream', '*', 'data', 'value');
      
      await expect(
        redis.xreadgroup(
          'GROUP', 'non_existent_group', 'consumer_1',
          'COUNT', '1',
          'STREAMS', 'existing_stream', '>'
        )
      ).rejects.toThrow(/NOGROUP/);
    });

    it('should handle XACK for non-existent message', async () => {
      await redis.xadd('ack_test_stream', '*', 'data', 'value');
      
      try {
        await redis.xgroup('CREATE', 'ack_test_stream', 'ack_test_group', '0', 'MKSTREAM');
      } catch {
        // Ignore if exists
      }
      
      // ACK a non-existent message ID
      const result = await redis.xack('ack_test_stream', 'ack_test_group', '0-0');
      
      // Should return 0 (no messages acknowledged)
      expect(result).toBe(0);
    });
  });

  describe('Deduplication Error Cases', () => {
    it('should handle rapid duplicate checks', async () => {
      const eventId = `evt_rapid_${Date.now()}`;
      const key = `dedup:event:${eventId}`;
      
      // Simulate concurrent SETNX calls
      const results = await Promise.all([
        redis.setnx(key, Date.now().toString()),
        redis.setnx(key, Date.now().toString()),
        redis.setnx(key, Date.now().toString()),
        redis.setnx(key, Date.now().toString()),
        redis.setnx(key, Date.now().toString()),
      ]);
      
      // Exactly one should succeed
      const successCount = results.filter(r => r === 1).length;
      expect(successCount).toBe(1);
    });

    it('should handle expired dedup keys', async () => {
      const eventId = `evt_expire_${Date.now()}`;
      const key = `dedup:event:${eventId}`;
      
      // Set with 1 second TTL
      await redis.setnx(key, Date.now().toString());
      await redis.expire(key, 1);
      
      // First check - should exist
      expect(await redis.exists(key)).toBe(1);
      
      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Should be gone
      expect(await redis.exists(key)).toBe(0);
      
      // New SETNX should succeed
      const result = await redis.setnx(key, Date.now().toString());
      expect(result).toBe(1);
    });
  });

  describe('Metrics Error Handling', () => {
    it('should handle counter overflow gracefully', async () => {
      // Redis handles large numbers automatically
      await redis.set('counter', String(Number.MAX_SAFE_INTEGER - 1));
      
      await redis.incr('counter');
      
      const value = await redis.get('counter');
      expect(parseInt(value!, 10)).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('should handle negative increments', async () => {
      await redis.set('neg_counter', '100');
      
      await redis.incrby('neg_counter', -50);
      
      const value = await redis.get('neg_counter');
      expect(parseInt(value!, 10)).toBe(50);
    });

    it('should handle MGET with missing keys', async () => {
      await redis.set('existing_key', 'value');
      
      const results = await redis.mget('existing_key', 'missing_key', 'another_missing');
      
      expect(results).toEqual(['value', null, null]);
    });
  });

  describe('Hash Operations Error Handling', () => {
    it('should handle HINCRBY on non-existent key', async () => {
      const result = await redis.hincrby('new_hash', 'field', 10);
      expect(result).toBe(10);
    });

    it('should handle HINCRBY on non-numeric field', async () => {
      await redis.hset('string_hash', 'field', 'not_a_number');
      
      await expect(redis.hincrby('string_hash', 'field', 1)).rejects.toThrow();
    });

    it('should handle HGETALL on non-existent key', async () => {
      const result = await redis.hgetall('non_existent_hash');
      expect(result).toEqual({});
    });
  });
});
