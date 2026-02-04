/**
 * Unit Tests: Edge Cases
 * Tests for error handling, malformed payloads, and service failures
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateEventPayload, validateBatchPayload } from '../../application/events/event.validator.js';

describe('Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Malformed Event Payloads', () => {
    it('should reject null payload', () => {
      const result = validateEventPayload(null);
      expect(result.valid).toBe(false);
    });

    it('should reject undefined payload', () => {
      const result = validateEventPayload(undefined);
      expect(result.valid).toBe(false);
    });

    it('should reject string payload', () => {
      const result = validateEventPayload('not an object');
      expect(result.valid).toBe(false);
    });

    it('should reject array payload', () => {
      const result = validateEventPayload([1, 2, 3]);
      expect(result.valid).toBe(false);
    });

    it('should reject empty object', () => {
      const result = validateEventPayload({});
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject payload with null userId', () => {
      const result = validateEventPayload({
        eventType: 'click',
        userId: null,
        sessionId: 'sess_1',
        timestamp: new Date().toISOString(),
      });
      expect(result.valid).toBe(false);
    });

    it('should reject payload with empty string userId', () => {
      const result = validateEventPayload({
        eventType: 'click',
        userId: '',
        sessionId: 'sess_1',
        timestamp: new Date().toISOString(),
      });
      expect(result.valid).toBe(false);
    });

    it('should reject payload with numeric userId', () => {
      const result = validateEventPayload({
        eventType: 'click',
        userId: 12345,
        sessionId: 'sess_1',
        timestamp: new Date().toISOString(),
      });
      expect(result.valid).toBe(false);
    });

    it('should reject payload with invalid timestamp format', () => {
      const invalidTimestamps = [
        '2024-01-30', // Missing time
        'Jan 30, 2024', // Wrong format
        '1706616000000', // Unix timestamp as string
        12345678, // Number
        '', // Empty string
      ];

      for (const timestamp of invalidTimestamps) {
        const result = validateEventPayload({
          eventType: 'click',
          userId: 'user_1',
          sessionId: 'sess_1',
          timestamp,
        });
        expect(result.valid).toBe(false);
      }
    });

    it('should reject eventType with special characters', () => {
      const invalidEventTypes = [
        'event<script>', // XSS attempt
        'event;DROP TABLE', // SQL injection attempt
        'event\n\r', // Newlines
        '../../../etc/passwd', // Path traversal
        'event with spaces',
      ];

      for (const eventType of invalidEventTypes) {
        const result = validateEventPayload({
          eventType,
          userId: 'user_1',
          sessionId: 'sess_1',
          timestamp: new Date().toISOString(),
        });
        expect(result.valid).toBe(false);
      }
    });

    it('should reject eventType starting with number', () => {
      const result = validateEventPayload({
        eventType: '123click',
        userId: 'user_1',
        sessionId: 'sess_1',
        timestamp: new Date().toISOString(),
      });
      expect(result.valid).toBe(false);
    });

    it('should reject very long userId (buffer overflow prevention)', () => {
      const result = validateEventPayload({
        eventType: 'click',
        userId: 'a'.repeat(200), // Exceeds maxLength
        sessionId: 'sess_1',
        timestamp: new Date().toISOString(),
      });
      expect(result.valid).toBe(false);
    });

    it('should reject negative priority', () => {
      const result = validateEventPayload({
        eventType: 'click',
        userId: 'user_1',
        sessionId: 'sess_1',
        timestamp: new Date().toISOString(),
        priority: -1,
      });
      expect(result.valid).toBe(false);
    });

    it('should reject priority above maximum', () => {
      const result = validateEventPayload({
        eventType: 'click',
        userId: 'user_1',
        sessionId: 'sess_1',
        timestamp: new Date().toISOString(),
        priority: 100,
      });
      expect(result.valid).toBe(false);
    });

    it('should reject non-integer priority', () => {
      const result = validateEventPayload({
        eventType: 'click',
        userId: 'user_1',
        sessionId: 'sess_1',
        timestamp: new Date().toISOString(),
        priority: 1.5,
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('Malformed Batch Payloads', () => {
    it('should reject batch with null events', () => {
      const result = validateBatchPayload({ events: null });
      expect(result.valid).toBe(false);
    });

    it('should reject batch with string instead of array', () => {
      const result = validateBatchPayload({ events: 'not an array' });
      expect(result.valid).toBe(false);
    });

    it('should reject batch exceeding max size', () => {
      const events = Array.from({ length: 1001 }, () => ({
        eventType: 'click',
        userId: 'user_1',
        sessionId: 'sess_1',
        timestamp: new Date().toISOString(),
      }));
      
      const result = validateBatchPayload({ events });
      expect(result.valid).toBe(false);
    });

    it('should reject batch with mixed valid and invalid events', () => {
      const result = validateBatchPayload({
        events: [
          {
            eventType: 'click',
            userId: 'user_1',
            sessionId: 'sess_1',
            timestamp: new Date().toISOString(),
          },
          {
            // Invalid - missing required fields
            eventType: 'click',
          },
        ],
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('Boundary Conditions', () => {
    it('should accept minimum valid event', () => {
      const result = validateEventPayload({
        eventType: 'a', // Minimum length
        userId: 'u',
        sessionId: 's',
        timestamp: new Date().toISOString(),
      });
      expect(result.valid).toBe(true);
    });

    it('should accept maximum length eventType', () => {
      const result = validateEventPayload({
        eventType: 'a'.repeat(100), // Max length
        userId: 'user_1',
        sessionId: 'sess_1',
        timestamp: new Date().toISOString(),
      });
      expect(result.valid).toBe(true);
    });

    it('should accept batch with exactly 1000 events', () => {
      const events = Array.from({ length: 1000 }, (_, i) => ({
        eventType: 'click',
        userId: `user_${i}`,
        sessionId: `sess_${i}`,
        timestamp: new Date().toISOString(),
      }));
      
      const result = validateBatchPayload({ events });
      expect(result.valid).toBe(true);
      expect(result.data?.events).toHaveLength(1000);
    });

    it('should accept priority at boundaries (0 and 3)', () => {
      const result0 = validateEventPayload({
        eventType: 'click',
        userId: 'user_1',
        sessionId: 'sess_1',
        timestamp: new Date().toISOString(),
        priority: 0,
      });
      expect(result0.valid).toBe(true);

      const result3 = validateEventPayload({
        eventType: 'click',
        userId: 'user_1',
        sessionId: 'sess_1',
        timestamp: new Date().toISOString(),
        priority: 3,
      });
      expect(result3.valid).toBe(true);
    });

    it('should handle complex metadata object', () => {
      const result = validateEventPayload({
        eventType: 'click',
        userId: 'user_1',
        sessionId: 'sess_1',
        timestamp: new Date().toISOString(),
        metadata: {
          nested: {
            deeply: {
              value: 'test',
            },
          },
          array: [1, 2, 3],
          mixed: [{ a: 1 }, 'string', 123],
        },
      });
      expect(result.valid).toBe(true);
    });

    it('should handle unicode in userId', () => {
      const result = validateEventPayload({
        eventType: 'click',
        userId: 'user_日本語_🎉',
        sessionId: 'sess_1',
        timestamp: new Date().toISOString(),
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('Event Type Patterns', () => {
    it('should accept valid eventType patterns', () => {
      const validEventTypes = [
        'click',
        'pageView',
        'page_view',
        'page-view',
        'page.view',
        'PageView123',
        'a',
        'A',
      ];

      for (const eventType of validEventTypes) {
        const result = validateEventPayload({
          eventType,
          userId: 'user_1',
          sessionId: 'sess_1',
          timestamp: new Date().toISOString(),
        });
        expect(result.valid).toBe(true);
      }
    });
  });
});
