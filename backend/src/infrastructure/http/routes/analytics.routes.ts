/**
 * Analytics Routes
 * Provides business metrics and aggregations for the Dashboard
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { getAnalyticsMetrics } from '../../../application/analytics/analytics.service.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('analytics-routes');

// Response schemas
const analyticsResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      properties: {
        totalEvents: { type: 'integer', description: 'Total number of events in time range' },
        timeRange: {
          type: 'object',
          properties: {
            start: { type: 'string', format: 'date-time' },
            end: { type: 'string', format: 'date-time' },
          },
        },
        eventsByType: {
          type: 'array',
          description: 'Events breakdown by type',
          items: {
            type: 'object',
            properties: {
              eventType: { type: 'string' },
              count: { type: 'integer' },
              percentage: { type: 'number' },
            },
          },
        },
        topUsers: {
          type: 'array',
          description: 'Top users by event count',
          items: {
            type: 'object',
            properties: {
              userId: { type: 'string' },
              eventCount: { type: 'integer' },
              lastEventAt: { type: 'string', format: 'date-time' },
              eventTypes: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        eventsOverTime: {
          type: 'array',
          description: 'Events aggregated over time intervals',
          items: {
            type: 'object',
            properties: {
              timestamp: { type: 'string', format: 'date-time' },
              count: { type: 'integer' },
            },
          },
        },
        avgEventsPerUser: { type: 'number', description: 'Average events per user' },
        uniqueUsers: { type: 'integer', description: 'Number of unique users' },
        uniqueSessions: { type: 'integer', description: 'Number of unique sessions' },
      },
    },
  },
} as const;

const errorResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
      },
    },
  },
} as const;

export const analyticsRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance
): Promise<void> => {
  // GET /analytics/metrics
  fastify.get<{
    Querystring: {
      timeRange?: string;
      eventType?: string;
      userId?: string;
    };
  }>('/analytics/metrics', {
    schema: {
      tags: ['Analytics'],
      summary: 'Get analytics metrics',
      description: 'Returns comprehensive analytics including event counts, top users, events by type, and time series data. Results are cached for 10 seconds.',
      querystring: {
        type: 'object',
        properties: {
          timeRange: { 
            type: 'string',
            enum: ['15m', '1h', '24h', '7d'],
            default: '1h',
            description: 'Time range for analytics',
          },
          eventType: { 
            type: 'string',
            description: 'Filter by event type',
          },
          userId: { 
            type: 'string',
            description: 'Filter by user ID (supports partial match)',
          },
        },
      },
      response: {
        200: analyticsResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { timeRange = '1h', eventType, userId } = request.query;
    
    try {
      const metrics = await getAnalyticsMetrics(timeRange, eventType, userId);
      
      logger.debug({
        timeRange,
        eventType,
        userId,
        totalEvents: metrics.totalEvents,
      }, 'Analytics metrics fetched');
      
      return reply.send({
        success: true,
        data: metrics,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      logger.error({ 
        error: errorMessage,
        stack: errorStack,
        timeRange,
        eventType,
        userId,
      }, 'Failed to fetch analytics metrics');
      
      return reply.status(500).send({
        success: false,
        error: {
          code: 'ANALYTICS_ERROR',
          message: `Failed to fetch analytics metrics: ${errorMessage}`,
        },
      });
    }
  });
};
