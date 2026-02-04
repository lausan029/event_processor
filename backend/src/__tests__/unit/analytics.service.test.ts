/**
 * Unit Tests: Analytics Service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDatabase, createMockMongoModule } from '../mocks/mongodb.mock.js';
import { mockRedisClient, createMockRedisModule } from '../mocks/redis.mock.js';

// Mock dependencies
vi.mock('../../infrastructure/database/mongodb.client.js', () => createMockMongoModule());
vi.mock('../../infrastructure/database/redis.client.js', () => createMockRedisModule());

// Mock cache service
vi.mock('../../application/analytics/analytics-cache.service.js', () => ({
  getCachedMetrics: vi.fn(() => null),
  cacheMetrics: vi.fn(),
}));

// Import after mocking
const { parseTimeRange, getAnalyticsMetrics } = await import('../../application/analytics/analytics.service.js');

describe('Analytics Service', () => {
  beforeEach(() => {
    mockDatabase.clear();
    mockRedisClient.clear();
    vi.clearAllMocks();
  });

  describe('parseTimeRange', () => {
    it('should parse 15m time range', () => {
      const now = new Date();
      const result = parseTimeRange('15m');
      
      expect(result.end.getTime()).toBeCloseTo(now.getTime(), -3);
      expect(result.start.getTime()).toBeLessThan(result.end.getTime());
      
      const diffMinutes = (result.end.getTime() - result.start.getTime()) / (1000 * 60);
      expect(diffMinutes).toBeCloseTo(15, 0);
    });

    it('should parse 1h time range', () => {
      const result = parseTimeRange('1h');
      
      const diffHours = (result.end.getTime() - result.start.getTime()) / (1000 * 60 * 60);
      expect(diffHours).toBeCloseTo(1, 0);
    });

    it('should parse 24h time range', () => {
      const result = parseTimeRange('24h');
      
      const diffHours = (result.end.getTime() - result.start.getTime()) / (1000 * 60 * 60);
      expect(diffHours).toBeCloseTo(24, 0);
    });

    it('should parse 7d time range', () => {
      const result = parseTimeRange('7d');
      
      const diffDays = (result.end.getTime() - result.start.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeCloseTo(7, 0);
    });

    it('should default to 1h for unknown range', () => {
      const result = parseTimeRange('unknown');
      
      const diffHours = (result.end.getTime() - result.start.getTime()) / (1000 * 60 * 60);
      expect(diffHours).toBeCloseTo(1, 0);
    });
  });

  describe('getAnalyticsMetrics', () => {
    it('should return empty metrics when no events exist', async () => {
      const metrics = await getAnalyticsMetrics('1h');
      
      expect(metrics.totalEvents).toBe(0);
      expect(metrics.eventsByType).toEqual([]);
      expect(metrics.topUsers).toEqual([]);
      expect(metrics.uniqueUsers).toBe(0);
    });

    it('should return metrics with correct time range', async () => {
      const metrics = await getAnalyticsMetrics('24h');
      
      expect(metrics.timeRange).toBeDefined();
      expect(metrics.timeRange.start).toBeDefined();
      expect(metrics.timeRange.end).toBeDefined();
      
      const start = new Date(metrics.timeRange.start);
      const end = new Date(metrics.timeRange.end);
      const diffHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
      
      expect(diffHours).toBeCloseTo(24, 0);
    });

    it('should include eventsOverTime array', async () => {
      const metrics = await getAnalyticsMetrics('1h');
      
      expect(Array.isArray(metrics.eventsOverTime)).toBe(true);
    });

    it('should calculate avgEventsPerUser correctly', async () => {
      // With no users, should be 0
      const metrics = await getAnalyticsMetrics('1h');
      
      expect(metrics.avgEventsPerUser).toBe(0);
    });
  });
});
