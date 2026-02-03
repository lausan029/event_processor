/**
 * MongoDB Client for Event Processor
 * Optimized for high-throughput operations with sharded collections
 * Shard Key: hashed(userId)
 */

import { MongoClient, type Db, type Collection, type BulkWriteResult } from 'mongodb';
import type { Config } from '../../config/index.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('mongodb-client');

let mongoClient: MongoClient | null = null;
let database: Db | null = null;

export interface StoredEvent {
  eventId: string;
  userId: string;  // Shard key - must be included in all operations
  eventType: string;
  payload: Record<string, unknown>;
  timestamp: Date;
  priority: number;
  metadata?: Record<string, unknown>;
  status: 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'DEAD_LETTER';
  processedAt?: Date;
  retryCount: number;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeadLetterEvent {
  originalEventId: string;
  userId: string;
  eventData: Record<string, unknown>;
  errorMessage: string;
  failedAt: Date;
  retryCount: number;
  streamMessageId: string;
}

export async function createMongoClient(config: Config): Promise<MongoClient> {
  if (mongoClient) {
    return mongoClient;
  }

  mongoClient = new MongoClient(config.mongo.uri, {
    // Connection pool settings for high throughput
    maxPoolSize: 100,
    minPoolSize: 10,
    maxIdleTimeMS: 30000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    // Write concern for durability vs performance balance
    writeConcern: {
      w: 1,  // Acknowledge from primary only for speed
      journal: false,  // Disable journaling for bulk writes (events are in Redis anyway)
    },
    // Read preference
    readPreference: 'primaryPreferred',
  });

  await mongoClient.connect();
  database = mongoClient.db(config.mongo.database);
  
  logger.info({ database: config.mongo.database }, 'MongoDB client connected');

  return mongoClient;
}

export function getMongoDatabase(): Db {
  if (!database) {
    throw new Error('MongoDB not initialized. Call createMongoClient first.');
  }
  return database;
}

export function getEventsCollection(): Collection<StoredEvent> {
  return getMongoDatabase().collection<StoredEvent>('events');
}

export function getDeadLetterCollection(): Collection<DeadLetterEvent> {
  return getMongoDatabase().collection<DeadLetterEvent>('events_dlq');
}

export async function closeMongoClient(): Promise<void> {
  if (mongoClient) {
    await mongoClient.close();
    mongoClient = null;
    database = null;
    logger.info('MongoDB client closed');
  }
}

/**
 * Bulk write events with sharding awareness
 * All events MUST include userId for proper shard distribution
 */
export async function bulkWriteEvents(events: StoredEvent[]): Promise<BulkWriteResult> {
  const collection = getEventsCollection();
  
  const operations = events.map(event => ({
    insertOne: {
      document: {
        ...event,
        // Ensure timestamps are Date objects
        timestamp: new Date(event.timestamp),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
  }));

  // Execute bulk write with ordered: false for better performance
  // This allows parallel execution and continues even if some fail
  const result = await collection.bulkWrite(operations, {
    ordered: false,
  });

  return result;
}

/**
 * Write events to Dead Letter Queue
 */
export async function writeToDeadLetterQueue(events: DeadLetterEvent[]): Promise<void> {
  const collection = getDeadLetterCollection();
  
  if (events.length === 0) return;

  await collection.insertMany(events, { ordered: false });
  
  logger.error({ 
    count: events.length,
    eventIds: events.map(e => e.originalEventId)
  }, 'Events moved to Dead Letter Queue');
}
