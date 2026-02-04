import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAnalyticsMetrics } from '../../api/analytics';

describe('Analytics API', () => {
  beforeEach(() => {
    vi.mocked(global.fetch).mockReset();
  });

  describe('getAnalyticsMetrics', () => {
    it('should fetch metrics with default filters', async () => {
      const mockData = {
        totalEvents: 1000,
        uniqueUsers: 50,
        uniqueSessions: 100,
        avgEventsPerUser: 20,
        eventsByType: [],
        topUsers: [],
        eventsOverTime: [],
        timeRange: { start: '', end: '' },
      };
      
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockData }),
      } as Response);

      const result = await getAnalyticsMetrics({});

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/analytics/metrics'),
      );
      expect(result.totalEvents).toBe(1000);
    });

    it('should include timeRange filter in query', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: {} }),
      } as Response);

      await getAnalyticsMetrics({ timeRange: '24h' });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('timeRange=24h'),
      );
    });

    it('should include eventType filter in query', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: {} }),
      } as Response);

      await getAnalyticsMetrics({ eventType: 'click' });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('eventType=click'),
      );
    });

    it('should include userId filter in query', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: {} }),
      } as Response);

      await getAnalyticsMetrics({ userId: 'user_123' });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('userId=user_123'),
      );
    });

    it('should throw error when API returns non-ok response', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Server error' }),
      } as Response);

      await expect(getAnalyticsMetrics({})).rejects.toThrow('Failed to fetch analytics metrics');
    });

    it('should throw error on network failure', async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error('Network unavailable'));

      await expect(getAnalyticsMetrics({})).rejects.toThrow('Network unavailable');
    });
  });
});
