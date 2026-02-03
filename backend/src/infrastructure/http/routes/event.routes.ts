/**
 * Event Ingestion Routes
 * POST /api/v1/events - Ingest single event
 * POST /api/v1/events/batch - Ingest batch of events
 * 
 * Critical path optimized for 50k EPS:
 * - API Key auth with Redis cache
 * - AJV schema validation
 * - SETNX deduplication
 * - XADD to Redis Stream
 * - 202 Accepted response (no DB wait)
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { authenticateApiKey } from '../middleware/apikey.middleware.js';
import {
  validateEventPayload,
  validateBatchPayload,
} from '../../../application/events/event.validator.js';
import {
  ingestEvent,
  ingestBatch,
  getIngestionRate,
  getTotalIngested,
} from '../../../application/events/ingestion.service.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('event-routes');

export const eventRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance
): Promise<void> => {
  // Apply API Key authentication to all routes in this plugin
  fastify.addHook('preHandler', authenticateApiKey);

  /**
   * POST /events
   * Ingest a single event
   * 
   * Headers:
   *   x-api-key: evp_xxx... (required)
   * 
   * Body:
   *   {
   *     "eventType": "click",
   *     "userId": "user-123",
   *     "sessionId": "sess-456",
   *     "timestamp": "2024-01-30T12:00:00Z",
   *     "metadata": { ... },
   *     "payload": { ... },
   *     "priority": 1
   *   }
   * 
   * Response: 202 Accepted (or 200 OK for duplicates)
   */
  fastify.post('/events', async (request, reply) => {
    // Validate request body
    const validation = validateEventPayload(request.body);

    if (!validation.valid) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: validation.error,
        },
      });
    }

    const event = validation.data!;
    const sourceUserId = request.apiKeyPayload?.userId;

    try {
      const result = await ingestEvent(event, sourceUserId);

      if (result.duplicate) {
        // 200 OK for duplicates (idempotent - not an error)
        return reply.status(200).send({
          success: true,
          data: {
            eventId: result.eventId,
            accepted: false,
            duplicate: true,
            message: result.message,
          },
        });
      }

      // 202 Accepted for new events
      return reply.status(202).send({
        success: true,
        data: {
          eventId: result.eventId,
          accepted: true,
          duplicate: false,
          message: result.message,
        },
      });
    } catch (error) {
      logger.error({ error, eventType: event.eventType }, 'Event ingestion failed');
      
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INGESTION_ERROR',
          message: 'Failed to ingest event',
        },
      });
    }
  });

  /**
   * POST /events/batch
   * Ingest multiple events in a single request
   * 
   * Headers:
   *   x-api-key: evp_xxx... (required)
   * 
   * Body:
   *   {
   *     "events": [
   *       { "eventType": "click", ... },
   *       { "eventType": "purchase", ... }
   *     ]
   *   }
   * 
   * Response: 202 Accepted
   */
  fastify.post('/events/batch', async (request, reply) => {
    // Validate request body
    const validation = validateBatchPayload(request.body);

    if (!validation.valid) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: validation.error,
        },
      });
    }

    const { events } = validation.data!;
    const sourceUserId = request.apiKeyPayload?.userId;

    try {
      const result = await ingestBatch(events, sourceUserId);

      // Always 202 for batch (even if some are duplicates)
      return reply.status(202).send({
        success: true,
        data: {
          accepted: result.accepted,
          duplicates: result.duplicates,
          total: events.length,
          eventIds: result.eventIds,
          message: result.message,
        },
      });
    } catch (error) {
      logger.error({ error, batchSize: events.length }, 'Batch ingestion failed');
      
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INGESTION_ERROR',
          message: 'Failed to ingest batch',
        },
      });
    }
  });

  /**
   * GET /events/stats
   * Get ingestion statistics (for monitoring)
   */
  fastify.get('/events/stats', async (_request, reply) => {
    try {
      const [ingestionRate, totalIngested] = await Promise.all([
        getIngestionRate(),
        getTotalIngested(),
      ]);

      return reply.send({
        success: true,
        data: {
          ingestionRate,      // Events per second
          totalIngested,      // Total events ingested
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to fetch ingestion stats');
      
      return reply.status(500).send({
        success: false,
        error: {
          code: 'STATS_ERROR',
          message: 'Failed to fetch stats',
        },
      });
    }
  });
};
