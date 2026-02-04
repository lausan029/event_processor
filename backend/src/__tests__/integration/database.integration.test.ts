/**
 * Integration Tests: Database Operations
 * Uses Testcontainers for real MongoDB and Redis instances
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { MongoClient, type Db } from 'mongodb';
import Redis from 'ioredis';

describe('Database Integration Tests', () => {
  let mongoContainer: StartedTestContainer;
  let redisContainer: StartedTestContainer;
  let mongoClient: MongoClient;
  let mongodb: Db;
  let redis: Redis;

  beforeAll(async () => {
    // Start MongoDB container
    mongoContainer = await new GenericContainer('mongo:6')
      .withExposedPorts(27017)
      .withWaitStrategy(Wait.forLogMessage('Waiting for connections'))
      .start();

    // Start Redis container
    redisContainer = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start();

    // Connect to MongoDB
    const mongoUri = `mongodb://${mongoContainer.getHost()}:${mongoContainer.getMappedPort(27017)}`;
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    mongodb = mongoClient.db('test_events');

    // Connect to Redis
    redis = new Redis({
      host: redisContainer.getHost(),
      port: redisContainer.getMappedPort(6379),
    });
  }, 120000);

  afterAll(async () => {
    await mongoClient?.close();
    await redis?.quit();
    await mongoContainer?.stop();
    await redisContainer?.stop();
  });

  beforeEach(async () => {
    // Clean up before each test
    await mongodb.collection('events').deleteMany({});
    await redis.flushall();
  });

  describe('MongoDB Event Storage', () => {
    it('should insert and retrieve events', async () => {
      const event = {
        eventId: 'evt_test_1',
        eventType: 'page_view',
        userId: 'user_123',
        sessionId: 'sess_456',
        timestamp: new Date().toISOString(),
        createdAt: new Date(),
      };

      await mongodb.collection('events').insertOne(event);

      const retrieved = await mongodb.collection('events').findOne({ eventId: 'evt_test_1' });
      
      expect(retrieved).toBeDefined();
      expect(retrieved?.eventType).toBe('page_view');
      expect(retrieved?.userId).toBe('user_123');
    });

    it('should support bulk write operations', async () => {
      const events = Array.from({ length: 100 }, (_, i) => ({
        insertOne: {
          document: {
            eventId: `evt_bulk_${i}`,
            eventType: i % 2 === 0 ? 'click' : 'view',
            userId: `user_${i % 10}`,
            sessionId: `sess_${i}`,
            createdAt: new Date(),
          },
        },
      }));

      const result = await mongodb.collection('events').bulkWrite(events);

      expect(result.insertedCount).toBe(100);

      const count = await mongodb.collection('events').countDocuments();
      expect(count).toBe(100);
    });

    it('should aggregate events by type', async () => {
      // Insert test data
      const events = [
        { eventType: 'click', userId: 'u1', createdAt: new Date() },
        { eventType: 'click', userId: 'u2', createdAt: new Date() },
        { eventType: 'view', userId: 'u1', createdAt: new Date() },
        { eventType: 'purchase', userId: 'u3', createdAt: new Date() },
      ];

      await mongodb.collection('events').insertMany(events);

      const pipeline = [
        { $group: { _id: '$eventType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ];

      const results = await mongodb.collection('events').aggregate(pipeline).toArray();

      expect(results).toHaveLength(3);
      expect(results.find(r => r._id === 'click')?.count).toBe(2);
    });

    it('should query by time range', async () => {
      const now = new Date();
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      await mongodb.collection('events').insertMany([
        { eventId: 'old', createdAt: twoHoursAgo },
        { eventId: 'recent', createdAt: new Date(now.getTime() - 30 * 60 * 1000) },
        { eventId: 'now', createdAt: now },
      ]);

      const recentEvents = await mongodb.collection('events').find({
        createdAt: { $gte: hourAgo },
      }).toArray();

      expect(recentEvents).toHaveLength(2);
    });
  });

  describe('Redis Deduplication', () => {
    it('should implement SETNX for deduplication', async () => {
      const eventId = 'evt_dedup_test';
      const key = `dedup:event:${eventId}`;

      // First attempt - should succeed
      const first = await redis.setnx(key, Date.now().toString());
      expect(first).toBe(1);

      // Second attempt - should fail
      const second = await redis.setnx(key, Date.now().toString());
      expect(second).toBe(0);
    });

    it('should expire deduplication keys', async () => {
      const eventId = 'evt_expire_test';
      const key = `dedup:event:${eventId}`;

      await redis.setnx(key, Date.now().toString());
      await redis.expire(key, 1);

      // Key exists initially
      expect(await redis.exists(key)).toBe(1);

      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Key should be gone
      expect(await redis.exists(key)).toBe(0);
    });

    it('should support pipeline operations', async () => {
      const pipeline = redis.pipeline();
      
      for (let i = 0; i < 50; i++) {
        pipeline.setnx(`dedup:batch:${i}`, Date.now().toString());
      }

      const results = await pipeline.exec();

      expect(results).toHaveLength(50);
      expect(results?.every(([err, val]) => err === null && val === 1)).toBe(true);
    });
  });

  describe('Redis Streams', () => {
    const STREAM_NAME = 'test_events_stream';
    const GROUP_NAME = 'test_workers';

    it('should add messages to stream', async () => {
      const messageId = await redis.xadd(
        STREAM_NAME,
        '*',
        'eventId', 'evt_stream_1',
        'eventType', 'click',
        'userId', 'user_123'
      );

      expect(messageId).toBeDefined();
      expect(messageId).toMatch(/^\d+-\d+$/);
    });

    it('should create consumer group', async () => {
      // Create stream first
      await redis.xadd(STREAM_NAME, '*', 'init', 'true');
      
      // Create consumer group
      try {
        await redis.xgroup('CREATE', STREAM_NAME, GROUP_NAME, '0', 'MKSTREAM');
      } catch (error) {
        // Group may already exist
      }

      // Add message
      await redis.xadd(STREAM_NAME, '*', 'eventId', 'evt_1');

      // Read with consumer group
      const messages = await redis.xreadgroup(
        'GROUP', GROUP_NAME, 'consumer_1',
        'COUNT', '10',
        'STREAMS', STREAM_NAME, '>'
      );

      expect(messages).toBeDefined();
    });

    it('should acknowledge messages', async () => {
      const testStream = `ack_stream_${Date.now()}`;
      const testGroup = `ack_group_${Date.now()}`;
      
      // Create stream with initial message
      const setupId = await redis.xadd(testStream, '*', 'setup', 'true');
      expect(setupId).toBeDefined();
      
      // Create consumer group starting from beginning
      await redis.xgroup('CREATE', testStream, testGroup, '0', 'MKSTREAM');

      // Add test message
      const msgId = await redis.xadd(testStream, '*', 'key', 'value');
      expect(msgId).toBeDefined();

      // Read messages with consumer group
      const messages = await redis.xreadgroup(
        'GROUP', testGroup, 'consumer_1',
        'COUNT', '10',
        'STREAMS', testStream, '>'
      );

      // We should have read both setup and test messages
      expect(messages).toBeDefined();
      expect(messages).not.toBeNull();
      
      if (messages && messages.length > 0) {
        const [, streamMsgs] = messages[0] as [string, Array<[string, string[]]>];
        expect(streamMsgs.length).toBeGreaterThanOrEqual(1);
        
        // Acknowledge all messages
        const ids = streamMsgs.map(([id]) => id);
        const acked = await redis.xack(testStream, testGroup, ...ids);
        expect(acked).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('MongoDB Indexes', () => {
    it('should create indexes for optimal queries', async () => {
      const collection = mongodb.collection('events');

      // Create indexes
      await collection.createIndex({ userId: 'hashed' });
      await collection.createIndex({ timestamp: -1 });
      await collection.createIndex({ eventType: 1 });
      await collection.createIndex({ createdAt: 1 });

      const indexes = await collection.indexes();

      expect(indexes.length).toBeGreaterThanOrEqual(4);
    });
  });
});
