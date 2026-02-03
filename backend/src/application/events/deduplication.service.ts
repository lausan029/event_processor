/**
 * Event Deduplication Service
 * Uses Redis SETNX for idempotency (as per project rules)
 * 
 * Prevents duplicate event processing by tracking eventIds
 * TTL: 10 minutes (balances memory usage vs duplicate window)
 */

import crypto from 'crypto';
import { getRedisClient } from '../../infrastructure/database/redis.client.js';
import { createLogger } from '../../infrastructure/logging/logger.js';

const logger = createLogger('deduplication');

// Deduplication TTL: 10 minutes
const DEDUP_TTL_SECONDS = 600;

// Redis key prefix
const DEDUP_KEY_PREFIX = 'dedup:event:';

/**
 * Generate a deterministic hash for an event
 * Used when eventId is not provided
 */
export function generateEventHash(
  userId: string,
  eventType: string,
  sessionId: string,
  timestamp: string,
  payload?: Record<string, unknown>
): string {
  const data = JSON.stringify({
    userId,
    eventType,
    sessionId,
    timestamp,
    payload: payload ?? {},
  });
  
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);
}

/**
 * Generate a unique event ID
 * Uses timestamp + random for uniqueness
 */
export function generateEventId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(8).toString('hex');
  return `evt_${timestamp}_${random}`;
}

/**
 * Check if event is a duplicate using SETNX
 * Returns true if event is NEW (not a duplicate)
 * Returns false if event is a DUPLICATE (should be ignored)
 * 
 * This is idempotent - calling multiple times with same ID returns same result
 */
export async function tryMarkEventAsProcessing(eventId: string): Promise<boolean> {
  const redis = getRedisClient();
  const key = `${DEDUP_KEY_PREFIX}${eventId}`;
  
  // SETNX: Set if Not eXists
  // Returns 1 if key was set (new event)
  // Returns 0 if key already exists (duplicate)
  const result = await redis.setnx(key, Date.now().toString());
  
  if (result === 1) {
    // New event - set TTL
    await redis.expire(key, DEDUP_TTL_SECONDS);
    return true; // Event is NEW
  }
  
  // Event is a duplicate
  logger.debug({ eventId }, 'Duplicate event detected');
  return false;
}

/**
 * Batch deduplication check
 * Returns array of event IDs that are NEW (not duplicates)
 */
export async function batchDeduplicationCheck(eventIds: string[]): Promise<{
  newEventIds: Set<string>;
  duplicateCount: number;
}> {
  const redis = getRedisClient();
  const newEventIds = new Set<string>();
  let duplicateCount = 0;

  // Use pipeline for efficiency
  const pipeline = redis.pipeline();
  
  for (const eventId of eventIds) {
    const key = `${DEDUP_KEY_PREFIX}${eventId}`;
    pipeline.setnx(key, Date.now().toString());
  }

  const results = await pipeline.exec();

  // Process results and set TTLs for new events
  const ttlPipeline = redis.pipeline();
  
  for (let i = 0; i < eventIds.length; i++) {
    const result = results?.[i];
    const eventId = eventIds[i];
    
    if (result && result[1] === 1 && eventId) {
      // New event
      newEventIds.add(eventId);
      ttlPipeline.expire(`${DEDUP_KEY_PREFIX}${eventId}`, DEDUP_TTL_SECONDS);
    } else if (eventId) {
      duplicateCount++;
    }
  }

  if (newEventIds.size > 0) {
    await ttlPipeline.exec();
  }

  if (duplicateCount > 0) {
    logger.debug({ 
      total: eventIds.length, 
      duplicates: duplicateCount,
      new: newEventIds.size 
    }, 'Batch deduplication completed');
  }

  return { newEventIds, duplicateCount };
}

/**
 * Clear deduplication key (for testing or manual cleanup)
 */
export async function clearDeduplicationKey(eventId: string): Promise<void> {
  const redis = getRedisClient();
  await redis.del(`${DEDUP_KEY_PREFIX}${eventId}`);
}
