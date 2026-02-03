/**
 * Real-time Metrics Service
 * Stores metrics in Redis for fast Dashboard access without hitting MongoDB
 */

import { getRedisClient } from '../../infrastructure/database/redis.client.js';
import { createLogger } from '../../infrastructure/logging/logger.js';

const logger = createLogger('metrics-service');

const METRICS_KEY = 'metrics:realtime';
const METRICS_TTL = 86400;  // 24 hours

export interface RealtimeMetrics {
  totalEvents: number;
  eventsPerSecond: number;
  eventsByType: Record<string, number>;
  lastProcessedTimestamp: string;
  lastBatchSize: number;
  totalBatches: number;
  failedEvents: number;
  dlqEvents: number;
}

/**
 * Update metrics after successful batch processing
 */
export async function updateBatchMetrics(
  batchSize: number,
  eventTypes: string[],
  processingTimeMs: number
): Promise<void> {
  const redis = getRedisClient();
  const now = new Date().toISOString();

  try {
    // Use a pipeline for atomic updates
    const pipeline = redis.pipeline();

    // Increment total events
    pipeline.hincrby(METRICS_KEY, 'total_events', batchSize);
    
    // Increment total batches
    pipeline.hincrby(METRICS_KEY, 'total_batches', 1);
    
    // Update last processed timestamp
    pipeline.hset(METRICS_KEY, 'last_processed_timestamp', now);
    
    // Update last batch size
    pipeline.hset(METRICS_KEY, 'last_batch_size', batchSize.toString());
    
    // Update last processing time
    pipeline.hset(METRICS_KEY, 'last_processing_time_ms', processingTimeMs.toString());

    // Increment events by type
    const typeCount: Record<string, number> = {};
    for (const type of eventTypes) {
      typeCount[type] = (typeCount[type] ?? 0) + 1;
    }
    
    for (const [type, count] of Object.entries(typeCount)) {
      pipeline.hincrby(METRICS_KEY, `events_type:${type}`, count);
    }

    // Set TTL to prevent stale data
    pipeline.expire(METRICS_KEY, METRICS_TTL);

    // Update rolling EPS calculation (events in last minute)
    const epsKey = `metrics:eps:${Math.floor(Date.now() / 1000)}`;
    pipeline.incrby(epsKey, batchSize);
    pipeline.expire(epsKey, 120);  // Keep for 2 minutes

    await pipeline.exec();

    logger.debug({
      batchSize,
      processingTimeMs,
      uniqueTypes: Object.keys(typeCount).length
    }, 'Metrics updated');

  } catch (error) {
    logger.error({ error }, 'Failed to update metrics');
    // Don't throw - metrics failure shouldn't stop processing
  }
}

/**
 * Record failed events
 */
export async function recordFailedEvents(count: number): Promise<void> {
  const redis = getRedisClient();
  
  try {
    await redis.hincrby(METRICS_KEY, 'failed_events', count);
  } catch (error) {
    logger.error({ error }, 'Failed to record failed events metric');
  }
}

/**
 * Record DLQ events
 */
export async function recordDLQEvents(count: number): Promise<void> {
  const redis = getRedisClient();
  
  try {
    await redis.hincrby(METRICS_KEY, 'dlq_events', count);
  } catch (error) {
    logger.error({ error }, 'Failed to record DLQ events metric');
  }
}

/**
 * Get current metrics for dashboard
 */
export async function getRealtimeMetrics(): Promise<RealtimeMetrics> {
  const redis = getRedisClient();

  const data = await redis.hgetall(METRICS_KEY);

  // Calculate events per second from rolling windows
  const now = Math.floor(Date.now() / 1000);
  let totalEventsLastMinute = 0;

  // Sum up events from the last 60 seconds
  const keys: string[] = [];
  for (let i = 0; i < 60; i++) {
    keys.push(`metrics:eps:${now - i}`);
  }

  const counts = await redis.mget(...keys);
  for (const count of counts) {
    if (count !== null) {
      totalEventsLastMinute += parseInt(count, 10);
    }
  }

  const eventsPerSecond = Math.round(totalEventsLastMinute / 60);

  // Extract events by type
  const eventsByType: Record<string, number> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('events_type:')) {
      const type = key.replace('events_type:', '');
      eventsByType[type] = parseInt(String(value), 10);
    }
  }

  return {
    totalEvents: parseInt(data['total_events'] ?? '0', 10),
    eventsPerSecond,
    eventsByType,
    lastProcessedTimestamp: data['last_processed_timestamp'] ?? '',
    lastBatchSize: parseInt(data['last_batch_size'] ?? '0', 10),
    totalBatches: parseInt(data['total_batches'] ?? '0', 10),
    failedEvents: parseInt(data['failed_events'] ?? '0', 10),
    dlqEvents: parseInt(data['dlq_events'] ?? '0', 10),
  };
}

/**
 * Reset metrics (for testing or maintenance)
 */
export async function resetMetrics(): Promise<void> {
  const redis = getRedisClient();
  await redis.del(METRICS_KEY);
  logger.info('Metrics reset');
}
