/**
 * Analytics Service
 * Provides business metrics and aggregations from MongoDB
 * Uses efficient aggregation pipelines optimized for sharded collections
 */

import { getMongoDatabase } from '../../infrastructure/database/mongodb.client.js';
import { createLogger } from '../../infrastructure/logging/logger.js';
import { getCachedMetrics, cacheMetrics } from './analytics-cache.service.js';

const logger = createLogger('analytics-service');

export interface TimeRange {
  start: Date;
  end: Date;
}

export interface EventsByTypeMetric {
  eventType: string;
  count: number;
  percentage: number;
}

export interface TopUser {
  userId: string;
  eventCount: number;
  lastEventAt: Date;
  eventTypes: string[];
}

export interface AnalyticsMetrics {
  totalEvents: number;
  timeRange: {
    start: string;
    end: string;
  };
  eventsByType: EventsByTypeMetric[];
  topUsers: TopUser[];
  eventsOverTime: {
    timestamp: string;
    count: number;
  }[];
  avgEventsPerUser: number;
  uniqueUsers: number;
  uniqueSessions: number;
}

/**
 * Parse time range string to Date objects
 */
export function parseTimeRange(range: string): TimeRange {
  const end = new Date();
  const start = new Date();
  
  switch (range) {
    case '15m':
      start.setMinutes(end.getMinutes() - 15);
      break;
    case '1h':
      start.setHours(end.getHours() - 1);
      break;
    case '24h':
      start.setHours(end.getHours() - 24);
      break;
    case '7d':
      start.setDate(end.getDate() - 7);
      break;
    default:
      start.setHours(end.getHours() - 1);
  }
  
  return { start, end };
}

/**
 * Get events by type with efficient aggregation
 */
export async function getEventsByType(
  timeRange: TimeRange,
  eventTypeFilter?: string
): Promise<EventsByTypeMetric[]> {
  const db = getMongoDatabase();
  const collection = db.collection('events');
  
  const matchStage: Record<string, unknown> = {
    createdAt: {
      $gte: timeRange.start,
      $lte: timeRange.end,
    },
  };
  
  if (eventTypeFilter) {
    matchStage['eventType'] = eventTypeFilter;
  }
  
  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: '$eventType',
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ];
  
  const results = await collection.aggregate(pipeline).toArray();
  const totalEvents = results.reduce((sum, item) => sum + (item['count'] as number), 0);
  
  return results.map((item) => ({
    eventType: item['_id'] as string,
    count: item['count'] as number,
    percentage: totalEvents > 0 ? ((item['count'] as number / totalEvents) * 100) : 0,
  }));
}

/**
 * Get top users by event count
 */
export async function getTopUsers(
  timeRange: TimeRange,
  limit: number = 10,
  userIdFilter?: string
): Promise<TopUser[]> {
  const db = getMongoDatabase();
  const collection = db.collection('events');
  
  const matchStage: Record<string, unknown> = {
    createdAt: {
      $gte: timeRange.start,
      $lte: timeRange.end,
    },
  };
  
  if (userIdFilter) {
    matchStage['userId'] = { $regex: userIdFilter, $options: 'i' };
  }
  
  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: '$userId',
        eventCount: { $sum: 1 },
        lastEventAt: { $max: '$createdAt' },
        eventTypes: { $addToSet: '$eventType' },
      },
    },
    { $sort: { eventCount: -1 } },
    { $limit: limit },
  ];
  
  const results = await collection.aggregate(pipeline).toArray();
  
  return results.map((item) => ({
    userId: item['_id'] as string,
    eventCount: item['eventCount'] as number,
    lastEventAt: item['lastEventAt'] as Date,
    eventTypes: item['eventTypes'] as string[],
  }));
}

/**
 * Get events over time (time series data)
 */
export async function getEventsOverTime(
  timeRange: TimeRange,
  intervalMinutes: number = 5
): Promise<{ timestamp: string; count: number }[]> {
  const db = getMongoDatabase();
  const collection = db.collection('events');
  
  const pipeline = [
    {
      $match: {
        createdAt: {
          $gte: timeRange.start,
          $lte: timeRange.end,
        },
      },
    },
    {
      $group: {
        _id: {
          $dateTrunc: {
            date: '$createdAt',
            unit: 'minute',
            binSize: intervalMinutes,
          },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ];
  
  const results = await collection.aggregate(pipeline).toArray();
  
  return results.map((item) => ({
    timestamp: (item['_id'] as Date).toISOString(),
    count: item['count'] as number,
  }));
}

/**
 * Get comprehensive analytics metrics
 */
export async function getAnalyticsMetrics(
  timeRangeStr: string = '1h',
  eventTypeFilter?: string,
  userIdFilter?: string
): Promise<AnalyticsMetrics> {
  // Try to get from cache first
  const cached = await getCachedMetrics(timeRangeStr, eventTypeFilter, userIdFilter);
  if (cached) {
    logger.debug({ timeRange: timeRangeStr }, 'Returning cached analytics metrics');
    return cached;
  }
  
  const timeRange = parseTimeRange(timeRangeStr);
  const db = getMongoDatabase();
  const collection = db.collection('events');
  
  logger.info({
    timeRange: timeRangeStr,
    eventTypeFilter,
    userIdFilter,
  }, 'Fetching analytics metrics from MongoDB');
  
  // Build match stage
  const matchStage: Record<string, unknown> = {
    createdAt: {
      $gte: timeRange.start,
      $lte: timeRange.end,
    },
  };
  
  if (eventTypeFilter) {
    matchStage['eventType'] = eventTypeFilter;
  }
  
  if (userIdFilter) {
    matchStage['userId'] = { $regex: userIdFilter, $options: 'i' };
  }
  
  // Run aggregations in parallel for better performance
  const [
    eventsByType,
    topUsers,
    eventsOverTime,
    generalStats,
  ] = await Promise.all([
    getEventsByType(timeRange, eventTypeFilter),
    getTopUsers(timeRange, 10, userIdFilter),
    getEventsOverTime(timeRange, 5),
    collection.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalEvents: { $sum: 1 },
          uniqueUsers: { $addToSet: '$userId' },
          uniqueSessions: { $addToSet: '$sessionId' },
        },
      },
    ]).toArray(),
  ]);
  
  const stats = generalStats[0] || {
    totalEvents: 0,
    uniqueUsers: [],
    uniqueSessions: [],
  };
  
  const uniqueUsersCount = (stats['uniqueUsers'] as string[]).length;
  const avgEventsPerUser = uniqueUsersCount > 0 
    ? (stats['totalEvents'] as number) / uniqueUsersCount 
    : 0;
  
  const metrics: AnalyticsMetrics = {
    totalEvents: stats['totalEvents'] as number,
    timeRange: {
      start: timeRange.start.toISOString(),
      end: timeRange.end.toISOString(),
    },
    eventsByType,
    topUsers,
    eventsOverTime,
    avgEventsPerUser: Math.round(avgEventsPerUser * 100) / 100,
    uniqueUsers: uniqueUsersCount,
    uniqueSessions: (stats['uniqueSessions'] as string[]).length,
  };
  
  // Cache the results for 10 seconds
  await cacheMetrics(metrics, timeRangeStr, eventTypeFilter, userIdFilter);
  
  return metrics;
}
