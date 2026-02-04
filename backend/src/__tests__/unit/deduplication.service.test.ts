/**
 * Unit Tests: Deduplication Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockRedisClient, createMockRedisModule } from '../mocks/redis.mock.js';

// Mock Redis before importing the service
vi.mock('../../infrastructure/database/redis.client.js', () => createMockRedisModule());

// Import after mocking
const { 
  generateEventHash, 
  generateEventId, 
  tryMarkEventAsProcessing,
  batchDeduplicationCheck,
  clearDeduplicationKey,
} = await import('../../application/events/deduplication.service.js');

describe('Deduplication Service', () => {
  beforeEach(() => {
    mockRedisClient.clear();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('generateEventHash', () => {
    it('should generate consistent hash for same input', () => {
      const hash1 = generateEventHash('user1', 'click', 'sess1', '2024-01-01T00:00:00Z');
      const hash2 = generateEventHash('user1', 'click', 'sess1', '2024-01-01T00:00:00Z');
      
      expect(hash1).toBe(hash2);
    });

    it('should generate different hash for different input', () => {
      const hash1 = generateEventHash('user1', 'click', 'sess1', '2024-01-01T00:00:00Z');
      const hash2 = generateEventHash('user2', 'click', 'sess1', '2024-01-01T00:00:00Z');
      
      expect(hash1).not.toBe(hash2);
    });

    it('should generate 32 character hash', () => {
      const hash = generateEventHash('user1', 'click', 'sess1', '2024-01-01T00:00:00Z');
      
      expect(hash).toHaveLength(32);
    });

    it('should include payload in hash when provided', () => {
      const hash1 = generateEventHash('user1', 'click', 'sess1', '2024-01-01T00:00:00Z');
      const hash2 = generateEventHash('user1', 'click', 'sess1', '2024-01-01T00:00:00Z', { data: 'test' });
      
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('generateEventId', () => {
    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateEventId());
      }
      
      expect(ids.size).toBe(100);
    });

    it('should start with evt_ prefix', () => {
      const id = generateEventId();
      
      expect(id).toMatch(/^evt_/);
    });
  });

  describe('tryMarkEventAsProcessing', () => {
    it('should return true for new event', async () => {
      const eventId = 'evt_new_event';
      
      const result = await tryMarkEventAsProcessing(eventId);
      
      expect(result).toBe(true);
    });

    it('should return false for duplicate event', async () => {
      const eventId = 'evt_duplicate';
      
      const first = await tryMarkEventAsProcessing(eventId);
      const second = await tryMarkEventAsProcessing(eventId);
      
      expect(first).toBe(true);
      expect(second).toBe(false);
    });

    it('should be idempotent - multiple calls return same result', async () => {
      const eventId = 'evt_idempotent';
      
      await tryMarkEventAsProcessing(eventId);
      
      const result1 = await tryMarkEventAsProcessing(eventId);
      const result2 = await tryMarkEventAsProcessing(eventId);
      const result3 = await tryMarkEventAsProcessing(eventId);
      
      expect(result1).toBe(false);
      expect(result2).toBe(false);
      expect(result3).toBe(false);
    });
  });

  describe('batchDeduplicationCheck', () => {
    it('should identify all new events in batch', async () => {
      const eventIds = ['evt_1', 'evt_2', 'evt_3'];
      
      const result = await batchDeduplicationCheck(eventIds);
      
      expect(result.newEventIds.size).toBe(3);
      expect(result.duplicateCount).toBe(0);
    });

    it('should identify duplicates in batch', async () => {
      // First, mark some events as processed
      await tryMarkEventAsProcessing('evt_existing_1');
      await tryMarkEventAsProcessing('evt_existing_2');
      
      const eventIds = ['evt_existing_1', 'evt_new_1', 'evt_existing_2'];
      
      const result = await batchDeduplicationCheck(eventIds);
      
      expect(result.newEventIds.size).toBe(1);
      expect(result.newEventIds.has('evt_new_1')).toBe(true);
      expect(result.duplicateCount).toBe(2);
    });

    it('should handle empty batch', async () => {
      const result = await batchDeduplicationCheck([]);
      
      expect(result.newEventIds.size).toBe(0);
      expect(result.duplicateCount).toBe(0);
    });

    it('should handle batch with all duplicates', async () => {
      const eventIds = ['evt_d1', 'evt_d2'];
      
      // Mark all as processed
      for (const id of eventIds) {
        await tryMarkEventAsProcessing(id);
      }
      
      const result = await batchDeduplicationCheck(eventIds);
      
      expect(result.newEventIds.size).toBe(0);
      expect(result.duplicateCount).toBe(2);
    });
  });

  describe('clearDeduplicationKey', () => {
    it('should allow re-processing after clearing', async () => {
      const eventId = 'evt_clearable';
      
      // First process
      const first = await tryMarkEventAsProcessing(eventId);
      expect(first).toBe(true);
      
      // Clear
      await clearDeduplicationKey(eventId);
      
      // Should be processable again
      const second = await tryMarkEventAsProcessing(eventId);
      expect(second).toBe(true);
    });
  });
});
