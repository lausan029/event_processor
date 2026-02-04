/**
 * Event Ingestion Routes
 * POST /api/v1/events - Ingest single event
 * POST /api/v1/events/batch - Ingest batch of events
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

// JSON Schemas for Swagger documentation
const eventSchema = {
  type: 'object',
  required: ['eventType', 'userId', 'sessionId', 'timestamp'],
  properties: {
    eventType: { type: 'string', description: 'Type of event' },
    userId: { type: 'string', description: 'User identifier' },
    sessionId: { type: 'string', description: 'Session identifier' },
    timestamp: { type: 'string', format: 'date-time', description: 'Event timestamp' },
    metadata: { type: 'object', description: 'Additional metadata', additionalProperties: true },
    payload: { type: 'object', description: 'Event payload data', additionalProperties: true },
    priority: { type: 'integer', minimum: 1, maximum: 10, default: 1, description: 'Event priority' },
  },
} as const;

const eventResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      properties: {
        eventId: { type: 'string' },
        accepted: { type: 'boolean' },
        duplicate: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
  },
} as const;

const batchRequestSchema = {
  type: 'object',
  required: ['events'],
  properties: {
    events: {
      type: 'array',
      items: eventSchema,
      minItems: 1,
      maxItems: 1000,
      description: 'Array of events to ingest',
    },
  },
} as const;

const batchResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      properties: {
        accepted: { type: 'integer', description: 'Number of accepted events' },
        duplicates: { type: 'integer', description: 'Number of duplicate events' },
        total: { type: 'integer', description: 'Total events in batch' },
        eventIds: { type: 'array', items: { type: 'string' } },
        message: { type: 'string' },
      },
    },
  },
} as const;

const statsResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      properties: {
        ingestionRate: { type: 'number', description: 'Events per second' },
        totalIngested: { type: 'integer', description: 'Total events ingested' },
        timestamp: { type: 'string', format: 'date-time' },
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

export const eventRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance
): Promise<void> => {
  // Apply API Key authentication to all routes in this plugin
  fastify.addHook('preHandler', authenticateApiKey);

  // POST /events - Ingest single event
  fastify.post('/events', {
    schema: {
      tags: ['Events'],
      summary: 'Ingest a single event',
      description: 'Accepts an event and queues it for processing. Returns 202 Accepted for new events, 200 OK for duplicates.',
      security: [{ apiKey: [] }],
      body: eventSchema,
      response: {
        202: eventResponseSchema,
        200: eventResponseSchema,
        400: errorResponseSchema,
        401: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
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

  // POST /events/batch - Ingest multiple events
  fastify.post('/events/batch', {
    schema: {
      tags: ['Events'],
      summary: 'Ingest a batch of events',
      description: 'Accepts up to 1000 events in a single request. All events are queued for processing.',
      security: [{ apiKey: [] }],
      body: batchRequestSchema,
      response: {
        202: batchResponseSchema,
        400: errorResponseSchema,
        401: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
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

  // GET /events/stats - Ingestion statistics
  fastify.get('/events/stats', {
    schema: {
      tags: ['Events'],
      summary: 'Get ingestion statistics',
      description: 'Returns real-time ingestion rate and total events processed.',
      security: [{ apiKey: [] }],
      response: {
        200: statsResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (_request, reply) => {
    try {
      const [ingestionRate, totalIngested] = await Promise.all([
        getIngestionRate(),
        getTotalIngested(),
      ]);

      return reply.send({
        success: true,
        data: {
          ingestionRate,
          totalIngested,
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
