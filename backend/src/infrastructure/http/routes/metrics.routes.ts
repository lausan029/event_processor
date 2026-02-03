/**
 * Metrics Routes
 * Provides real-time metrics for the dashboard
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { getRealtimeMetrics } from '../../../application/metrics/metrics.service.js';
import { getIngestionRate, getTotalIngested } from '../../../application/events/ingestion.service.js';
import { getStreamInfo } from '../../streams/redis-stream.client.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('metrics-routes');

export const metricsRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance
): Promise<void> => {
  /**
   * GET /metrics
   * Get real-time processing metrics
   */
  fastify.get('/', async (_request, reply) => {
    try {
      const [metrics, streamInfo, ingestionRate, totalIngested] = await Promise.all([
        getRealtimeMetrics(),
        getStreamInfo(),
        getIngestionRate(),
        getTotalIngested(),
      ]);

      return reply.send({
        success: true,
        data: {
          ingestion: {
            rate: ingestionRate,           // Events ingested per second
            totalIngested,                 // Total events ingested
          },
          processing: {
            totalEvents: metrics.totalEvents,
            eventsPerSecond: metrics.eventsPerSecond,
            totalBatches: metrics.totalBatches,
            lastBatchSize: metrics.lastBatchSize,
            lastProcessedTimestamp: metrics.lastProcessedTimestamp,
          },
          errors: {
            failedEvents: metrics.failedEvents,
            dlqEvents: metrics.dlqEvents,
          },
          queue: {
            streamLength: streamInfo.length,
            consumerGroups: streamInfo.groups,
            pendingMessages: streamInfo.pendingMessages,
          },
          eventsByType: metrics.eventsByType,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to fetch metrics');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'METRICS_ERROR',
          message: 'Failed to fetch metrics',
        },
      });
    }
  });

  /**
   * GET /metrics/stream
   * Get stream-specific info
   */
  fastify.get('/stream', async (_request, reply) => {
    try {
      const streamInfo = await getStreamInfo();

      return reply.send({
        success: true,
        data: streamInfo,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to fetch stream info');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'STREAM_ERROR',
          message: 'Failed to fetch stream info',
        },
      });
    }
  });

  /**
   * GET /metrics/ingestion
   * Get ingestion-specific metrics
   */
  fastify.get('/ingestion', async (_request, reply) => {
    try {
      const [ingestionRate, totalIngested] = await Promise.all([
        getIngestionRate(),
        getTotalIngested(),
      ]);

      return reply.send({
        success: true,
        data: {
          rate: ingestionRate,
          totalIngested,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to fetch ingestion metrics');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'METRICS_ERROR',
          message: 'Failed to fetch ingestion metrics',
        },
      });
    }
  });
};
