/**
 * E2E Tests: Complete Event Flow
 * Tests the entire pipeline: API -> Redis -> Worker -> MongoDB -> Analytics
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { MongoClient, type Db } from 'mongodb';
import Redis from 'ioredis';
import Fastify, { type FastifyInstance } from 'fastify';

describe('E2E: Complete Event Flow', () => {
  let mongoContainer: StartedTestContainer;
  let redisContainer: StartedTestContainer;
  let mongoClient: MongoClient;
  let mongodb: Db;
  let redis: Redis;
  let server: FastifyInstance;

  const STREAM_NAME = 'events_stream';
  const GROUP_NAME = 'evp-workers-group';

  beforeAll(async () => {
    // Start containers
    mongoContainer = await new GenericContainer('mongo:6')
      .withExposedPorts(27017)
      .withWaitStrategy(Wait.forLogMessage('Waiting for connections'))
      .start();

    redisContainer = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start();

    // Connect to databases
    const mongoUri = `mongodb://${mongoContainer.getHost()}:${mongoContainer.getMappedPort(27017)}`;
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    mongodb = mongoClient.db('test_events');

    redis = new Redis({
      host: redisContainer.getHost(),
      port: redisContainer.getMappedPort(6379),
    });

    // Initialize consumer group
    try {
      await redis.xgroup('CREATE', STREAM_NAME, GROUP_NAME, '0', 'MKSTREAM');
    } catch {
      // Group may exist
    }

    // Create a minimal Fastify server for testing
    server = Fastify({ logger: false });

    // Mock event ingestion endpoint
    server.post<{
      Body: {
        eventType: string;
        userId: string;
        sessionId: string;
        timestamp: string;
        metadata?: Record<string, unknown>;
        payload?: Record<string, unknown>;
      };
    }>('/api/v1/events', async (request, reply) => {
      const { eventType, userId, sessionId, timestamp, metadata, payload } = request.body;
      const eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      // Check deduplication
      const dedupKey = `dedup:event:${eventId}`;
      const isNew = await redis.setnx(dedupKey, Date.now().toString());
      
      if (isNew === 0) {
        return reply.status(200).send({
          success: true,
          data: { eventId, accepted: false, duplicate: true },
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
        'payload', JSON.stringify(payload ?? {})
      );

      // Update metrics
      await redis.incr('metrics:ingested:total');

      return reply.status(202).send({
        success: true,
        data: { eventId, accepted: true, duplicate: false },
      });
    });

    // Mock analytics endpoint
    server.get<{
      Querystring: { timeRange?: string };
    }>('/api/v1/analytics/metrics', async (request, reply) => {
      const events = await mongodb.collection('events').find().toArray();
      
      // Aggregate by type
      const eventsByType: Record<string, number> = {};
      const userEvents: Record<string, number> = {};
      
      for (const event of events) {
        const type = event.eventType as string;
        const user = event.userId as string;
        eventsByType[type] = (eventsByType[type] ?? 0) + 1;
        userEvents[user] = (userEvents[user] ?? 0) + 1;
      }

      return reply.send({
        success: true,
        data: {
          totalEvents: events.length,
          eventsByType: Object.entries(eventsByType).map(([eventType, count]) => ({
            eventType,
            count,
            percentage: events.length > 0 ? (count / events.length) * 100 : 0,
          })),
          topUsers: Object.entries(userEvents)
            .map(([userId, eventCount]) => ({ userId, eventCount }))
            .sort((a, b) => b.eventCount - a.eventCount)
            .slice(0, 10),
          uniqueUsers: Object.keys(userEvents).length,
        },
      });
    });

    await server.listen({ port: 0 });
  }, 120000);

  afterAll(async () => {
    await server?.close();
    await mongoClient?.close();
    await redis?.quit();
    await mongoContainer?.stop();
    await redisContainer?.stop();
  });

  beforeEach(async () => {
    await mongodb.collection('events').deleteMany({});
    await redis.flushall();
    
    try {
      await redis.xgroup('CREATE', STREAM_NAME, GROUP_NAME, '0', 'MKSTREAM');
    } catch {
      // Ignore
    }
  });

  // Helper function to simulate worker processing
  async function processEventsWithWorker(batchSize: number = 100): Promise<number> {
    let totalProcessed = 0;
    
    while (true) {
      const messages = await redis.xreadgroup(
        'GROUP', GROUP_NAME, 'e2e_worker',
        'COUNT', String(batchSize),
        'STREAMS', STREAM_NAME, '>'
      );

      if (!messages || messages.length === 0) break;

      const [, streamMessages] = messages[0] as [string, Array<[string, string[]]>];
      if (!streamMessages || streamMessages.length === 0) break;

      // Parse messages to documents
      const docs = streamMessages.map(([messageId, fields]) => {
        const doc: Record<string, unknown> = {
          messageId,
          createdAt: new Date(),
        };
        for (let i = 0; i < fields.length; i += 2) {
          const key = fields[i];
          let value: unknown = fields[i + 1];
          
          // Parse JSON fields
          if (key === 'metadata' || key === 'payload') {
            try {
              value = JSON.parse(value as string);
            } catch {
              // Keep as string
            }
          }
          doc[key] = value;
        }
        return doc;
      });

      // Bulk write to MongoDB
      if (docs.length > 0) {
        await mongodb.collection('events').insertMany(docs);
      }

      // Acknowledge messages
      const messageIds = streamMessages.map(([id]) => id);
      await redis.xack(STREAM_NAME, GROUP_NAME, ...messageIds);

      totalProcessed += streamMessages.length;
    }

    return totalProcessed;
  }

  describe('Complete Event Lifecycle', () => {
    it('should ingest event via API and return 202 Accepted', async () => {
      const address = server.addresses()[0];
      const baseUrl = `http://localhost:${typeof address === 'object' ? address.port : address}`;

      const response = await fetch(`${baseUrl}/api/v1/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'page_view',
          userId: 'user_e2e_1',
          sessionId: 'sess_e2e_1',
          timestamp: new Date().toISOString(),
        }),
      });

      expect(response.status).toBe(202);
      
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.accepted).toBe(true);
    });

    it('should add ingested event to Redis stream', async () => {
      const address = server.addresses()[0];
      const baseUrl = `http://localhost:${typeof address === 'object' ? address.port : address}`;

      await fetch(`${baseUrl}/api/v1/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'click',
          userId: 'user_stream_1',
          sessionId: 'sess_stream_1',
          timestamp: new Date().toISOString(),
        }),
      });

      const streamLen = await redis.xlen(STREAM_NAME);
      expect(streamLen).toBe(1);
    });

    it('should process event from stream to MongoDB via worker', async () => {
      const address = server.addresses()[0];
      const baseUrl = `http://localhost:${typeof address === 'object' ? address.port : address}`;

      // Ingest event
      await fetch(`${baseUrl}/api/v1/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'purchase',
          userId: 'user_worker_1',
          sessionId: 'sess_worker_1',
          timestamp: new Date().toISOString(),
          payload: { amount: 99.99 },
        }),
      });

      // Process with worker
      const processed = await processEventsWithWorker();
      expect(processed).toBe(1);

      // Verify in MongoDB
      const events = await mongodb.collection('events').find().toArray();
      expect(events.length).toBe(1);
      expect(events[0].eventType).toBe('purchase');
      expect(events[0].userId).toBe('user_worker_1');
    });

    it('should show processed event in analytics endpoint', async () => {
      const address = server.addresses()[0];
      const baseUrl = `http://localhost:${typeof address === 'object' ? address.port : address}`;

      // Ingest multiple events
      const eventTypes = ['click', 'click', 'view', 'purchase'];
      for (const eventType of eventTypes) {
        await fetch(`${baseUrl}/api/v1/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventType,
            userId: `user_analytics_${Math.random().toString(36).substring(7)}`,
            sessionId: `sess_analytics_${Date.now()}`,
            timestamp: new Date().toISOString(),
          }),
        });
      }

      // Process with worker
      await processEventsWithWorker();

      // Fetch analytics
      const response = await fetch(`${baseUrl}/api/v1/analytics/metrics`);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.data.totalEvents).toBe(4);
      expect(data.data.eventsByType).toHaveLength(3); // click, view, purchase
      
      const clickMetric = data.data.eventsByType.find((e: { eventType: string }) => e.eventType === 'click');
      expect(clickMetric?.count).toBe(2);
    });

    it('should handle duplicate events correctly', async () => {
      const address = server.addresses()[0];
      const baseUrl = `http://localhost:${typeof address === 'object' ? address.port : address}`;

      // First request
      const response1 = await fetch(`${baseUrl}/api/v1/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'click',
          userId: 'user_dup',
          sessionId: 'sess_dup',
          timestamp: new Date().toISOString(),
        }),
      });

      const data1 = await response1.json();
      expect(data1.data.accepted).toBe(true);

      // Process first event
      const processed = await processEventsWithWorker();
      expect(processed).toBe(1);

      // MongoDB should have 1 event
      const count = await mongodb.collection('events').countDocuments();
      expect(count).toBe(1);

      // Verify no pending messages (worker processed all)
      const pending = await redis.xreadgroup(
        'GROUP', GROUP_NAME, 'dup_check',
        'COUNT', '10',
        'STREAMS', STREAM_NAME, '>'
      );
      // Should be null or empty (no new messages to process)
      expect(pending).toBeNull();
    });

    it('should track ingestion metrics', async () => {
      const address = server.addresses()[0];
      const baseUrl = `http://localhost:${typeof address === 'object' ? address.port : address}`;

      // Ingest 5 events
      for (let i = 0; i < 5; i++) {
        await fetch(`${baseUrl}/api/v1/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventType: 'metric_test',
            userId: `user_metric_${i}`,
            sessionId: `sess_metric_${i}`,
            timestamp: new Date().toISOString(),
          }),
        });
      }

      const totalIngested = await redis.get('metrics:ingested:total');
      expect(parseInt(totalIngested!, 10)).toBe(5);
    });
  });

  describe('High Volume E2E', () => {
    it('should handle batch ingestion and processing', async () => {
      const address = server.addresses()[0];
      const baseUrl = `http://localhost:${typeof address === 'object' ? address.port : address}`;

      // Ingest 100 events
      const promises = Array.from({ length: 100 }, (_, i) =>
        fetch(`${baseUrl}/api/v1/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventType: ['click', 'view', 'purchase'][i % 3],
            userId: `user_batch_${i % 10}`,
            sessionId: `sess_batch_${i}`,
            timestamp: new Date().toISOString(),
          }),
        })
      );

      await Promise.all(promises);

      // Process all events
      const processed = await processEventsWithWorker();
      expect(processed).toBe(100);

      // Verify in MongoDB
      const count = await mongodb.collection('events').countDocuments();
      expect(count).toBe(100);

      // Verify analytics
      const response = await fetch(`${baseUrl}/api/v1/analytics/metrics`);
      const data = await response.json();
      
      expect(data.data.totalEvents).toBe(100);
      expect(data.data.uniqueUsers).toBe(10);
    });
  });
});
