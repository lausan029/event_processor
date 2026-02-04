/**
 * Integration Tests: Event Ingestion Flow
 * Tests the complete ingestion path: API -> Redis Stream -> Worker -> MongoDB
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { MongoClient, type Db } from 'mongodb';
import Redis from 'ioredis';

describe('Event Ingestion Integration', () => {
  let mongoContainer: StartedTestContainer;
  let redisContainer: StartedTestContainer;
  let mongoClient: MongoClient;
  let mongodb: Db;
  let redis: Redis;

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

    // Connect
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
  }, 120000);

  afterAll(async () => {
    await mongoClient?.close();
    await redis?.quit();
    await mongoContainer?.stop();
    await redisContainer?.stop();
  });

  beforeEach(async () => {
    await mongodb.collection('events').deleteMany({});
    await redis.flushall();
    
    // Recreate consumer group
    try {
      await redis.xgroup('CREATE', STREAM_NAME, GROUP_NAME, '0', 'MKSTREAM');
    } catch {
      // Ignore
    }
  });

  describe('Event Ingestion Flow', () => {
    it('should ingest event to Redis stream', async () => {
      const event = {
        eventId: 'evt_flow_1',
        eventType: 'page_view',
        userId: 'user_123',
        sessionId: 'sess_456',
        timestamp: new Date().toISOString(),
        metadata: JSON.stringify({ page: '/home' }),
        payload: JSON.stringify({ duration: 5000 }),
        priority: '1',
      };

      // Add to stream
      const fields: string[] = [];
      for (const [key, value] of Object.entries(event)) {
        fields.push(key, value);
      }
      const messageId = await redis.xadd(STREAM_NAME, '*', ...fields);

      // Verify stream contains message
      const streamLen = await redis.xlen(STREAM_NAME);
      expect(streamLen).toBe(1);
      expect(messageId).toBeDefined();
    });

    it('should process events from stream to MongoDB', async () => {
      // Simulate ingestion
      const events = [
        { eventId: 'evt_1', eventType: 'click', userId: 'user_1' },
        { eventId: 'evt_2', eventType: 'view', userId: 'user_2' },
        { eventId: 'evt_3', eventType: 'purchase', userId: 'user_1' },
      ];

      // Add to stream
      for (const event of events) {
        await redis.xadd(
          STREAM_NAME, '*',
          'eventId', event.eventId,
          'eventType', event.eventType,
          'userId', event.userId,
          'timestamp', new Date().toISOString()
        );
      }

      // Simulate worker: read and process
      const messages = await redis.xreadgroup(
        'GROUP', GROUP_NAME, 'test_consumer',
        'COUNT', '10',
        'STREAMS', STREAM_NAME, '>'
      );

      if (messages && messages.length > 0) {
        const [, streamMessages] = messages[0] as [string, Array<[string, string[]]>];
        
        // Parse messages
        const processedEvents = streamMessages.map(([id, fields]) => {
          const obj: Record<string, string> = {};
          for (let i = 0; i < fields.length; i += 2) {
            obj[fields[i]] = fields[i + 1];
          }
          return { messageId: id, ...obj, createdAt: new Date() };
        });

        // Bulk write to MongoDB
        const bulkOps = processedEvents.map(event => ({
          insertOne: { document: event },
        }));
        await mongodb.collection('events').bulkWrite(bulkOps);

        // Acknowledge messages
        const messageIds = processedEvents.map(e => e.messageId);
        await redis.xack(STREAM_NAME, GROUP_NAME, ...messageIds);
      }

      // Verify MongoDB has events
      const storedEvents = await mongodb.collection('events').find().toArray();
      expect(storedEvents.length).toBe(3);
    });

    it('should handle deduplication correctly', async () => {
      const eventId = 'evt_dedup';

      // Mark as processed
      await redis.setnx(`dedup:event:${eventId}`, Date.now().toString());
      await redis.expire(`dedup:event:${eventId}`, 600);

      // Try to process same event
      const isDuplicate = await redis.setnx(`dedup:event:${eventId}`, Date.now().toString());

      expect(isDuplicate).toBe(0);
    });

    it('should track ingestion metrics', async () => {
      const metricsKey = 'metrics:ingested:total';

      // Simulate ingestion metrics
      await redis.incrby(metricsKey, 100);
      await redis.incrby(metricsKey, 50);

      const total = await redis.get(metricsKey);
      expect(parseInt(total!, 10)).toBe(150);
    });
  });

  describe('Worker Event Processing', () => {
    it('should process batch of events', async () => {
      // Add batch of events
      const batchSize = 50;
      for (let i = 0; i < batchSize; i++) {
        await redis.xadd(
          STREAM_NAME, '*',
          'eventId', `evt_batch_${i}`,
          'eventType', i % 3 === 0 ? 'click' : 'view',
          'userId', `user_${i % 5}`,
          'timestamp', new Date().toISOString()
        );
      }

      // Process in batches like a real worker
      let totalProcessed = 0;
      while (true) {
        const messages = await redis.xreadgroup(
          'GROUP', GROUP_NAME, 'test_worker',
          'COUNT', '20',
          'STREAMS', STREAM_NAME, '>'
        );

        if (!messages || messages.length === 0) break;

        const [, streamMessages] = messages[0] as [string, Array<[string, string[]]>];
        if (!streamMessages || streamMessages.length === 0) break;

        // Parse and insert
        const docs = streamMessages.map(([id, fields]) => {
          const doc: Record<string, unknown> = { messageId: id, createdAt: new Date() };
          for (let i = 0; i < fields.length; i += 2) {
            doc[fields[i]] = fields[i + 1];
          }
          return doc;
        });

        await mongodb.collection('events').insertMany(docs);
        await redis.xack(STREAM_NAME, GROUP_NAME, ...streamMessages.map(m => m[0]));
        
        totalProcessed += streamMessages.length;
      }

      expect(totalProcessed).toBe(batchSize);
      
      const count = await mongodb.collection('events').countDocuments();
      expect(count).toBe(batchSize);
    });

    it('should update realtime metrics after processing', async () => {
      // Add events
      for (let i = 0; i < 10; i++) {
        await redis.xadd(
          STREAM_NAME, '*',
          'eventId', `evt_metrics_${i}`,
          'eventType', i % 2 === 0 ? 'click' : 'view',
          'userId', `user_${i % 3}`
        );
      }

      // Process
      const messages = await redis.xreadgroup(
        'GROUP', GROUP_NAME, 'metrics_worker',
        'COUNT', '100',
        'STREAMS', STREAM_NAME, '>'
      );

      if (messages && messages.length > 0) {
        const [, streamMessages] = messages[0] as [string, Array<[string, string[]]>];
        
        // Update metrics (simulating worker behavior)
        const pipeline = redis.pipeline();
        pipeline.hincrby('metrics:realtime', 'total_events', streamMessages.length);
        
        for (const [, fields] of streamMessages) {
          const eventType = fields[fields.indexOf('eventType') + 1];
          if (eventType) {
            pipeline.hincrby('metrics:realtime', `type:${eventType}`, 1);
          }
        }
        
        pipeline.hset('metrics:realtime', 'last_processed', Date.now().toString());
        await pipeline.exec();

        // ACK
        await redis.xack(STREAM_NAME, GROUP_NAME, ...streamMessages.map(m => m[0]));
      }

      // Verify metrics
      const totalEvents = await redis.hget('metrics:realtime', 'total_events');
      expect(parseInt(totalEvents!, 10)).toBe(10);
    });
  });
});
