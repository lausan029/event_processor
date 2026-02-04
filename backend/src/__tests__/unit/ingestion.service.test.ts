/**
 * Unit Tests: Ingestion Service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockRedisClient, createMockRedisModule } from '../mocks/redis.mock.js';

// Mock dependencies
vi.mock('../../infrastructure/database/redis.client.js', () => createMockRedisModule());
vi.mock('../../infrastructure/streams/redis-stream.client.js', () => ({
  addToStream: vi.fn().mockResolvedValue('1234567890-0'),
  STREAM_NAME: 'events_stream',
}));

// Import after mocking
const { ingestEvent, ingestBatch, getIngestionRate, getTotalIngested } = await import('../../application/events/ingestion.service.js');

describe('Ingestion Service', () => {
  beforeEach(() => {
    mockRedisClient.clear();
    vi.clearAllMocks();
  });

  describe('ingestEvent', () => {
    it('should accept valid event and return eventId', async () => {
      const event = {
        eventType: 'click',
        userId: 'user_123',
        sessionId: 'sess_456',
        timestamp: new Date().toISOString(),
      };

      const result = await ingestEvent(event);

      expect(result.accepted).toBe(true);
      expect(result.eventId).toBeDefined();
      expect(result.duplicate).toBe(false);
    });

    it('should use provided eventId if given', async () => {
      const event = {
        eventId: 'evt_custom_id',
        eventType: 'click',
        userId: 'user_123',
        sessionId: 'sess_456',
        timestamp: new Date().toISOString(),
      };

      const result = await ingestEvent(event);

      expect(result.eventId).toBe('evt_custom_id');
    });

    it('should detect duplicate events', async () => {
      const event = {
        eventId: 'evt_duplicate_test',
        eventType: 'click',
        userId: 'user_123',
        sessionId: 'sess_456',
        timestamp: new Date().toISOString(),
      };

      // First ingestion
      const first = await ingestEvent(event);
      expect(first.accepted).toBe(true);
      expect(first.duplicate).toBe(false);

      // Second ingestion with same ID
      const second = await ingestEvent(event);
      expect(second.accepted).toBe(false);
      expect(second.duplicate).toBe(true);
    });

    it('should include metadata in stream', async () => {
      const event = {
        eventType: 'purchase',
        userId: 'user_123',
        sessionId: 'sess_456',
        timestamp: new Date().toISOString(),
        metadata: { browser: 'Chrome' },
        payload: { amount: 99.99 },
      };

      const result = await ingestEvent(event, 'api_user_1');

      expect(result.accepted).toBe(true);
    });
  });

  describe('ingestBatch', () => {
    it('should accept batch of events', async () => {
      const events = Array.from({ length: 5 }, (_, i) => ({
        eventType: 'batch_event',
        userId: `user_${i}`,
        sessionId: `sess_${i}`,
        timestamp: new Date().toISOString(),
      }));

      const result = await ingestBatch(events);

      expect(result.accepted).toBe(5);
      expect(result.duplicates).toBe(0);
      expect(result.eventIds).toHaveLength(5);
    });

    it('should filter duplicates in batch', async () => {
      // First, ingest some events
      const event1 = {
        eventId: 'evt_batch_dup_1',
        eventType: 'click',
        userId: 'user_1',
        sessionId: 'sess_1',
        timestamp: new Date().toISOString(),
      };
      await ingestEvent(event1);

      // Now try batch with mix of new and duplicate
      const events = [
        event1, // Duplicate
        {
          eventType: 'click',
          userId: 'user_2',
          sessionId: 'sess_2',
          timestamp: new Date().toISOString(),
        },
      ];

      const result = await ingestBatch(events);

      expect(result.accepted).toBe(1);
      expect(result.duplicates).toBe(1);
    });

    it('should return empty result for all duplicates', async () => {
      const events = [
        {
          eventId: 'evt_all_dup_1',
          eventType: 'click',
          userId: 'user_1',
          sessionId: 'sess_1',
          timestamp: new Date().toISOString(),
        },
        {
          eventId: 'evt_all_dup_2',
          eventType: 'click',
          userId: 'user_2',
          sessionId: 'sess_2',
          timestamp: new Date().toISOString(),
        },
      ];

      // First ingest
      await ingestBatch(events);

      // Second ingest - all duplicates
      const result = await ingestBatch(events);

      expect(result.accepted).toBe(0);
      expect(result.duplicates).toBe(2);
      expect(result.eventIds).toHaveLength(0);
    });
  });

  describe('getIngestionRate', () => {
    it('should return 0 when no events ingested', async () => {
      const rate = await getIngestionRate();
      expect(rate).toBe(0);
    });

    it('should calculate rate from recent events', async () => {
      // Simulate some ingestion metrics
      const now = Math.floor(Date.now() / 1000);
      for (let i = 0; i < 10; i++) {
        await mockRedisClient.set(`metrics:ingested:${now - i}`, '100');
      }

      const rate = await getIngestionRate();
      // 1000 events in 60 seconds = ~16.67 per second
      expect(rate).toBeGreaterThan(0);
    });
  });

  describe('getTotalIngested', () => {
    it('should return 0 when counter not set', async () => {
      const total = await getTotalIngested();
      expect(total).toBe(0);
    });

    it('should return counter value', async () => {
      await mockRedisClient.set('metrics:ingested:total', '12345');
      
      const total = await getTotalIngested();
      expect(total).toBe(12345);
    });
  });
});
