/**
 * Analytics API Client
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface AnalyticsMetrics {
  totalEvents: number;
  timeRange: {
    start: string;
    end: string;
  };
  eventsByType: {
    eventType: string;
    count: number;
    percentage: number;
  }[];
  topUsers: {
    userId: string;
    eventCount: number;
    lastEventAt: string;
    eventTypes: string[];
  }[];
  eventsOverTime: {
    timestamp: string;
    count: number;
  }[];
  avgEventsPerUser: number;
  uniqueUsers: number;
  uniqueSessions: number;
}

export interface AnalyticsFilters {
  timeRange?: string;
  eventType?: string;
  userId?: string;
}

export async function getAnalyticsMetrics(
  filters: AnalyticsFilters = {}
): Promise<AnalyticsMetrics> {
  const params = new URLSearchParams();
  
  if (filters.timeRange) params.append('timeRange', filters.timeRange);
  if (filters.eventType) params.append('eventType', filters.eventType);
  if (filters.userId) params.append('userId', filters.userId);
  
  const url = `${API_BASE_URL}/api/v1/analytics/metrics?${params.toString()}`;
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error('Failed to fetch analytics metrics');
  }
  
  const data = await response.json();
  return data.data;
}
