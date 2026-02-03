/**
 * Event Ingestion Service
 * Handles the critical path: Validate → Deduplicate → XADD → Respond
 * 
 * Designed for 50k EPS throughput:
 * - No synchronous database writes
 * - Redis-only in the hot path
 * - Immediate 202 Accepted response
 */

import { getRedisClient } from '../../infrastructure/database/redis.client.js';
import { addToStream, STREAM_NAME } from '../../infrastructure/streams/redis-stream.client.js';
import { createLogger } from '../../infrastructure/logging/logger.js';
import {
  tryMarkEventAsProcessing,
  batchDeduplicationCheck,
  generateEventId,
} from './deduplication.service.js';
import type { IngestEventPayload } from './event.validator.js';

const logger = createLogger('ingestion-service');

// Redis keys for ingestion metrics
const METRICS_INGESTED_KEY = 'metrics:ingested';
const METRICS_INGESTED_TOTAL_KEY = 'metrics:ingested:total';
const METRICS_DUPLICATES_KEY = 'metrics:duplicates';

export interface IngestResult {
  accepted: boolean;
  eventId: string;
  duplicate: boolean;
  message: string;
}

export interface BatchIngestResult {
  accepted: number;
  duplicates: number;
  eventIds: string[];
  message: string;
}

/**
 * Update ingestion metrics
 */
async function updateIngestionMetrics(
  acceptedCount: number,
  duplicateCount: number
): Promise<void> {
  const redis = getRedisClient();
  const now = Math.floor(Date.now() / 1000);

  try {
    const pipeline = redis.pipeline();
    
    // Rolling per-second counter (for EPS calculation)
    const epsKey = `${METRICS_INGESTED_KEY}:${now}`;
    pipeline.incrby(epsKey, acceptedCount);
    pipeline.expire(epsKey, 120); // Keep for 2 minutes

    // Total counter
    pipeline.incrby(METRICS_INGESTED_TOTAL_KEY, acceptedCount);
    
    // Duplicate counter
    if (duplicateCount > 0) {
      pipeline.incrby(METRICS_DUPLICATES_KEY, duplicateCount);
    }

    await pipeline.exec();
  } catch (error) {
    // Metrics failure shouldn't block ingestion
    logger.error({ error }, 'Failed to update ingestion metrics');
  }
}

/**
 * Ingest a single event
 * Returns immediately after XADD (202 Accepted pattern)
 */
export async function ingestEvent(
  event: IngestEventPayload,
  sourceUserId?: string // From API key, for audit
): Promise<IngestResult> {
  // Generate or use provided event ID
  const eventId = event.eventId ?? generateEventId();

  // Deduplication check (SETNX)
  const isNew = await tryMarkEventAsProcessing(eventId);

  if (!isNew) {
    // Duplicate - return 200 OK (not an error, idempotent)
    await updateIngestionMetrics(0, 1);
    
    return {
      accepted: false,
      eventId,
      duplicate: true,
      message: 'Event already processed (duplicate)',
    };
  }

  // Add to Redis Stream
  const streamMessageId = await addToStream({
    eventId,
    userId: event.userId, // Critical: shard key
    eventType: event.eventType,
    payload: JSON.stringify(event.payload ?? {}),
    timestamp: event.timestamp,
    priority: String(event.priority ?? 1),
    metadata: event.metadata ? JSON.stringify({
      ...event.metadata,
      sessionId: event.sessionId,
      sourceUserId, // Who ingested this event
      ingestedAt: new Date().toISOString(),
    }) : JSON.stringify({
      sessionId: event.sessionId,
      sourceUserId,
      ingestedAt: new Date().toISOString(),
    }),
  });

  logger.debug({
    eventId,
    streamMessageId,
    eventType: event.eventType,
    userId: event.userId,
  }, 'Event ingested to stream');

  // Update metrics
  await updateIngestionMetrics(1, 0);

  return {
    accepted: true,
    eventId,
    duplicate: false,
    message: 'Event accepted for processing',
  };
}

/**
 * Ingest batch of events
 * Optimized for high throughput with pipelining
 */
export async function ingestBatch(
  events: IngestEventPayload[],
  sourceUserId?: string
): Promise<BatchIngestResult> {
  const redis = getRedisClient();
  
  // Prepare events with IDs
  const preparedEvents = events.map(event => ({
    ...event,
    eventId: event.eventId ?? generateEventId(),
  }));

  // Batch deduplication
  const eventIds = preparedEvents.map(e => e.eventId);
  const { newEventIds, duplicateCount } = await batchDeduplicationCheck(eventIds);

  // Filter out duplicates
  const eventsToIngest = preparedEvents.filter(e => newEventIds.has(e.eventId));

  if (eventsToIngest.length === 0) {
    // All duplicates
    await updateIngestionMetrics(0, duplicateCount);
    
    return {
      accepted: 0,
      duplicates: duplicateCount,
      eventIds: [],
      message: 'All events were duplicates',
    };
  }

  // Batch XADD using pipeline
  const pipeline = redis.pipeline();
  const acceptedIds: string[] = [];

  for (const event of eventsToIngest) {
    const streamArgs: (string | number)[] = [
      STREAM_NAME,
      '*', // Auto-generate stream ID
      'eventId', event.eventId,
      'userId', event.userId,
      'eventType', event.eventType,
      'payload', JSON.stringify(event.payload ?? {}),
      'timestamp', event.timestamp,
      'priority', String(event.priority ?? 1),
      'metadata', JSON.stringify({
        ...(event.metadata ?? {}),
        sessionId: event.sessionId,
        sourceUserId,
        ingestedAt: new Date().toISOString(),
      }),
    ];

    pipeline.xadd(...(streamArgs as [string, string, ...string[]]));
    acceptedIds.push(event.eventId);
  }

  await pipeline.exec();

  logger.info({
    total: events.length,
    accepted: eventsToIngest.length,
    duplicates: duplicateCount,
  }, 'Batch ingestion completed');

  // Update metrics
  await updateIngestionMetrics(eventsToIngest.length, duplicateCount);

  return {
    accepted: eventsToIngest.length,
    duplicates: duplicateCount,
    eventIds: acceptedIds,
    message: `${eventsToIngest.length} events accepted, ${duplicateCount} duplicates ignored`,
  };
}

/**
 * Get current ingestion rate (events per second)
 */
export async function getIngestionRate(): Promise<number> {
  const redis = getRedisClient();
  const now = Math.floor(Date.now() / 1000);

  let totalEvents = 0;
  const keys: string[] = [];

  // Get events from last 60 seconds
  for (let i = 0; i < 60; i++) {
    keys.push(`${METRICS_INGESTED_KEY}:${now - i}`);
  }

  const counts = await redis.mget(...keys);
  
  for (const count of counts) {
    if (count) {
      totalEvents += parseInt(count, 10);
    }
  }

  return Math.round(totalEvents / 60);
}

/**
 * Get total ingested events count
 */
export async function getTotalIngested(): Promise<number> {
  const redis = getRedisClient();
  const count = await redis.get(METRICS_INGESTED_TOTAL_KEY);
  return count ? parseInt(count, 10) : 0;
}
