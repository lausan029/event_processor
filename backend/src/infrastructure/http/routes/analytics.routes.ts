/**
 * Analytics Routes
 * Provides business metrics and aggregations for the Dashboard
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { getAnalyticsMetrics } from '../../../application/analytics/analytics.service.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('analytics-routes');

export const analyticsRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance
): Promise<void> => {
  /**
   * GET /api/v1/analytics/metrics
   * Get comprehensive analytics metrics with filters
   */
  fastify.get<{
    Querystring: {
      timeRange?: string;
      eventType?: string;
      userId?: string;
    };
  }>('/analytics/metrics', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          timeRange: { 
            type: 'string',
            enum: ['15m', '1h', '24h', '7d'],
            default: '1h',
          },
          eventType: { type: 'string' },
          userId: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                totalEvents: { type: 'number' },
                timeRange: {
                  type: 'object',
                  properties: {
                    start: { type: 'string' },
                    end: { type: 'string' },
                  },
                },
                eventsByType: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      eventType: { type: 'string' },
                      count: { type: 'number' },
                      percentage: { type: 'number' },
                    },
                  },
                },
                topUsers: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      userId: { type: 'string' },
                      eventCount: { type: 'number' },
                      lastEventAt: { type: 'string' },
                      eventTypes: {
                        type: 'array',
                        items: { type: 'string' },
                      },
                    },
                  },
                },
                eventsOverTime: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      timestamp: { type: 'string' },
                      count: { type: 'number' },
                    },
                  },
                },
                avgEventsPerUser: { type: 'number' },
                uniqueUsers: { type: 'number' },
                uniqueSessions: { type: 'number' },
              },
            },
          },
        },
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
