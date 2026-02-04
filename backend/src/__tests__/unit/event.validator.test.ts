/**
 * Unit Tests: Event Validator
 */

import { describe, it, expect } from 'vitest';
import {
  validateEventPayload,
  validateBatchPayload,
} from '../../application/events/event.validator.js';

describe('Event Validator', () => {
  describe('validateEventPayload', () => {
    it('should validate a correct event payload', () => {
      const validEvent = {
        eventType: 'page_view',
        userId: 'user_123',
        sessionId: 'sess_456',
        timestamp: '2024-01-30T12:00:00Z',
      };

      const result = validateEventPayload(validEvent);
      
      expect(result.valid).toBe(true);
      expect(result.data).toEqual(expect.objectContaining({
        eventType: 'page_view',
        userId: 'user_123',
        sessionId: 'sess_456',
      }));
    });

    it('should validate event with optional fields', () => {
      const eventWithOptionals = {
        eventType: 'purchase',
        userId: 'user_123',
        sessionId: 'sess_456',
        timestamp: '2024-01-30T12:00:00Z',
        metadata: { browser: 'Chrome' },
        payload: { amount: 99.99 },
        priority: 2,
      };

      const result = validateEventPayload(eventWithOptionals);
      
      expect(result.valid).toBe(true);
      expect(result.data?.metadata).toEqual({ browser: 'Chrome' });
      expect(result.data?.payload).toEqual({ amount: 99.99 });
      expect(result.data?.priority).toBe(2);
    });

    it('should reject event missing required field (eventType)', () => {
      const invalidEvent = {
        userId: 'user_123',
        sessionId: 'sess_456',
        timestamp: '2024-01-30T12:00:00Z',
      };

      const result = validateEventPayload(invalidEvent);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('eventType');
    });

    it('should reject event missing required field (userId)', () => {
      const invalidEvent = {
        eventType: 'click',
        sessionId: 'sess_456',
        timestamp: '2024-01-30T12:00:00Z',
      };

      const result = validateEventPayload(invalidEvent);
      
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject event with invalid timestamp format', () => {
      const invalidEvent = {
        eventType: 'click',
        userId: 'user_123',
        sessionId: 'sess_456',
        timestamp: 'not-a-timestamp',
      };

      const result = validateEventPayload(invalidEvent);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('timestamp');
    });

    it('should reject event with invalid eventType pattern', () => {
      const invalidEvent = {
        eventType: '123_invalid', // Must start with letter
        userId: 'user_123',
        sessionId: 'sess_456',
        timestamp: '2024-01-30T12:00:00Z',
      };

      const result = validateEventPayload(invalidEvent);
      
      expect(result.valid).toBe(false);
    });

    it('should reject event with priority out of range', () => {
      const invalidEvent = {
        eventType: 'click',
        userId: 'user_123',
        sessionId: 'sess_456',
        timestamp: '2024-01-30T12:00:00Z',
        priority: 10, // Max is 3
      };

      const result = validateEventPayload(invalidEvent);
      
      expect(result.valid).toBe(false);
    });

    it('should strip unknown fields', () => {
      const eventWithExtra = {
        eventType: 'click',
        userId: 'user_123',
        sessionId: 'sess_456',
        timestamp: '2024-01-30T12:00:00Z',
        unknownField: 'should be removed',
      };

      const result = validateEventPayload(eventWithExtra);
      
      expect(result.valid).toBe(true);
      expect((result.data as Record<string, unknown>)['unknownField']).toBeUndefined();
    });

    it('should apply default priority if not provided', () => {
      const eventWithoutPriority = {
        eventType: 'click',
        userId: 'user_123',
        sessionId: 'sess_456',
        timestamp: '2024-01-30T12:00:00Z',
      };

      const result = validateEventPayload(eventWithoutPriority);
      
      expect(result.valid).toBe(true);
      expect(result.data?.priority).toBe(1);
    });
  });

  describe('validateBatchPayload', () => {
    it('should validate a batch of valid events', () => {
      const validBatch = {
        events: [
          {
            eventType: 'click',
            userId: 'user_1',
            sessionId: 'sess_1',
            timestamp: '2024-01-30T12:00:00Z',
          },
          {
            eventType: 'purchase',
            userId: 'user_2',
            sessionId: 'sess_2',
            timestamp: '2024-01-30T12:01:00Z',
          },
        ],
      };

      const result = validateBatchPayload(validBatch);
      
      expect(result.valid).toBe(true);
      expect(result.data?.events).toHaveLength(2);
    });

    it('should reject empty batch', () => {
      const emptyBatch = {
        events: [],
      };

      const result = validateBatchPayload(emptyBatch);
      
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject batch without events array', () => {
      const invalidBatch = {};

      const result = validateBatchPayload(invalidBatch);
      
      expect(result.valid).toBe(false);
    });

    it('should reject batch with invalid event', () => {
      const batchWithInvalid = {
        events: [
          {
            eventType: 'click',
            userId: 'user_1',
            sessionId: 'sess_1',
            timestamp: '2024-01-30T12:00:00Z',
          },
          {
            // Missing required fields
            eventType: 'invalid',
          },
        ],
      };

      const result = validateBatchPayload(batchWithInvalid);
      
      expect(result.valid).toBe(false);
    });
  });
});
