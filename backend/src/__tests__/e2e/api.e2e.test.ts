/**
 * E2E Tests: API Endpoints
 * Tests HTTP API behavior with real-like server
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import Redis from 'ioredis';
import Fastify, { type FastifyInstance } from 'fastify';

describe('E2E: API Endpoints', () => {
  let redisContainer: StartedTestContainer;
  let redis: Redis;
  let server: FastifyInstance;
  let baseUrl: string;

  const STREAM_NAME = 'events_stream';

  beforeAll(async () => {
    // Start Redis container
    redisContainer = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start();

    redis = new Redis({
      host: redisContainer.getHost(),
      port: redisContainer.getMappedPort(6379),
    });

    // Create test server
    server = Fastify({ logger: false });

    // Health endpoint
    server.get('/api/health', async () => ({
      status: 'healthy',
      version: '1.0.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }));

    // Event ingestion with validation
    server.post<{
      Body: {
        eventType?: string;
        userId?: string;
        sessionId?: string;
        timestamp?: string;
        metadata?: Record<string, unknown>;
        payload?: Record<string, unknown>;
        priority?: number;
      };
      Headers: { 'x-api-key'?: string };
    }>('/api/v1/events', async (request, reply) => {
      // Check API key
      const apiKey = request.headers['x-api-key'];
      if (!apiKey || !apiKey.startsWith('evp_')) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Invalid API key' },
        });
      }

      const { eventType, userId, sessionId, timestamp, metadata, payload, priority } = request.body;

      // Validate required fields
      if (!eventType || !userId || !sessionId || !timestamp) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Missing required fields' },
        });
      }

      // Validate eventType pattern
      if (!/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(eventType)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid eventType format' },
        });
      }

      // Validate priority range
      if (priority !== undefined && (priority < 0 || priority > 3)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Priority must be between 0 and 3' },
        });
      }

      const eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      // Deduplication
      const dedupKey = `dedup:event:${eventId}`;
      const isNew = await redis.setnx(dedupKey, Date.now().toString());
      
      if (isNew === 0) {
        return reply.status(200).send({
          success: true,
          data: { eventId, accepted: false, duplicate: true, message: 'Event already processed' },
        });
      }
      await redis.expire(dedupKey, 600);

      // Add to stream
      await redis.xadd(
        STREAM_NAME, '*',
        'eventId', eventId,
        'eventType', eventType,
        'userId', userId,
        'sessionId', sessionId,
        'timestamp', timestamp,
        'metadata', JSON.stringify(metadata ?? {}),
        'payload', JSON.stringify(payload ?? {}),
        'priority', String(priority ?? 1)
      );

      // Update metrics
      await redis.incr('metrics:ingested:total');

      return reply.status(202).send({
        success: true,
        data: { eventId, accepted: true, duplicate: false, message: 'Event accepted for processing' },
      });
    });

    // Batch endpoint
    server.post<{
      Body: { events?: Array<Record<string, unknown>> };
      Headers: { 'x-api-key'?: string };
    }>('/api/v1/events/batch', async (request, reply) => {
      const apiKey = request.headers['x-api-key'];
      if (!apiKey || !apiKey.startsWith('evp_')) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Invalid API key' },
        });
      }

      const { events } = request.body;
      
      if (!events || !Array.isArray(events) || events.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Events array is required' },
        });
      }

      if (events.length > 1000) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Maximum 1000 events per batch' },
        });
      }

      let accepted = 0;
      let duplicates = 0;
      const eventIds: string[] = [];

      for (const event of events) {
        const eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        
        const dedupKey = `dedup:event:${eventId}`;
        const isNew = await redis.setnx(dedupKey, Date.now().toString());
        
        if (isNew === 0) {
          duplicates++;
          continue;
        }
        await redis.expire(dedupKey, 600);

        await redis.xadd(
          STREAM_NAME, '*',
          'eventId', eventId,
          'eventType', String(event.eventType ?? 'unknown'),
          'userId', String(event.userId ?? 'unknown'),
          'timestamp', new Date().toISOString()
        );

        accepted++;
        eventIds.push(eventId);
      }

      await redis.incrby('metrics:ingested:total', accepted);

      return reply.status(202).send({
        success: true,
        data: {
          accepted,
          duplicates,
          total: events.length,
          eventIds,
          message: `${accepted} events accepted, ${duplicates} duplicates ignored`,
        },
      });
    });

    // Stats endpoint
    server.get('/api/v1/events/stats', async (request, reply) => {
      const total = await redis.get('metrics:ingested:total');
      
      return reply.send({
        success: true,
        data: {
          ingestionRate: 0,
          totalIngested: total ? parseInt(total, 10) : 0,
          timestamp: new Date().toISOString(),
        },
      });
    });

    await server.listen({ port: 0 });
    const address = server.addresses()[0];
    baseUrl = `http://localhost:${typeof address === 'object' ? address.port : address}`;
  }, 120000);

  afterAll(async () => {
    await server?.close();
    await redis?.quit();
    await redisContainer?.stop();
  });

  beforeEach(async () => {
    await redis.flushall();
  });

  describe('Health Endpoint', () => {
    it('GET /api/health should return healthy status', async () => {
      const response = await fetch(`${baseUrl}/api/health`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('healthy');
      expect(data.version).toBe('1.0.0');
    });
  });

  describe('Event Ingestion Endpoint', () => {
    it('POST /api/v1/events should return 401 without API key', async () => {
      const response = await fetch(`${baseUrl}/api/v1/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'click',
          userId: 'user_1',
          sessionId: 'sess_1',
          timestamp: new Date().toISOString(),
        }),
      });

      expect(response.status).toBe(401);
    });

    it('POST /api/v1/events should return 400 for missing required fields', async () => {
      const response = await fetch(`${baseUrl}/api/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'evp_test_key',
        },
        body: JSON.stringify({
          eventType: 'click',
          // Missing userId, sessionId, timestamp
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('POST /api/v1/events should return 400 for invalid eventType', async () => {
      const response = await fetch(`${baseUrl}/api/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'evp_test_key',
        },
        body: JSON.stringify({
          eventType: '123invalid',
          userId: 'user_1',
          sessionId: 'sess_1',
          timestamp: new Date().toISOString(),
        }),
      });

      expect(response.status).toBe(400);
    });

    it('POST /api/v1/events should return 202 for valid event', async () => {
      const response = await fetch(`${baseUrl}/api/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'evp_test_key',
        },
        body: JSON.stringify({
          eventType: 'page_view',
          userId: 'user_valid',
          sessionId: 'sess_valid',
          timestamp: new Date().toISOString(),
        }),
      });

      expect(response.status).toBe(202);
      
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.accepted).toBe(true);
      expect(data.data.eventId).toMatch(/^evt_/);
    });

    it('POST /api/v1/events should accept optional fields', async () => {
      const response = await fetch(`${baseUrl}/api/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'evp_test_key',
        },
        body: JSON.stringify({
          eventType: 'purchase',
          userId: 'user_full',
          sessionId: 'sess_full',
          timestamp: new Date().toISOString(),
          metadata: { browser: 'Chrome', os: 'macOS' },
          payload: { amount: 99.99, currency: 'USD' },
          priority: 2,
        }),
      });

      expect(response.status).toBe(202);
    });

    it('POST /api/v1/events should reject invalid priority', async () => {
      const response = await fetch(`${baseUrl}/api/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'evp_test_key',
        },
        body: JSON.stringify({
          eventType: 'click',
          userId: 'user_1',
          sessionId: 'sess_1',
          timestamp: new Date().toISOString(),
          priority: 10,
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('Batch Endpoint', () => {
    it('POST /api/v1/events/batch should return 401 without API key', async () => {
      const response = await fetch(`${baseUrl}/api/v1/events/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: [] }),
      });

      expect(response.status).toBe(401);
    });

    it('POST /api/v1/events/batch should return 400 for empty events', async () => {
      const response = await fetch(`${baseUrl}/api/v1/events/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'evp_test_key',
        },
        body: JSON.stringify({ events: [] }),
      });

      expect(response.status).toBe(400);
    });

    it('POST /api/v1/events/batch should accept batch of events', async () => {
      const events = Array.from({ length: 10 }, (_, i) => ({
        eventType: 'batch_event',
        userId: `user_${i}`,
        sessionId: `sess_${i}`,
        timestamp: new Date().toISOString(),
      }));

      const response = await fetch(`${baseUrl}/api/v1/events/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'evp_test_key',
        },
        body: JSON.stringify({ events }),
      });

      expect(response.status).toBe(202);
      
      const data = await response.json();
      expect(data.data.accepted).toBe(10);
      expect(data.data.eventIds).toHaveLength(10);
    });
  });

  describe('Stats Endpoint', () => {
    it('GET /api/v1/events/stats should return ingestion stats', async () => {
      // Ingest some events first
      for (let i = 0; i < 5; i++) {
        await fetch(`${baseUrl}/api/v1/events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': 'evp_test_key',
          },
          body: JSON.stringify({
            eventType: 'stats_test',
            userId: `user_${i}`,
            sessionId: `sess_${i}`,
            timestamp: new Date().toISOString(),
          }),
        });
      }

      const response = await fetch(`${baseUrl}/api/v1/events/stats`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.totalIngested).toBe(5);
    });
  });
});
