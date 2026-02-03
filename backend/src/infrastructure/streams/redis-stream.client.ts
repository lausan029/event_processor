/**
 * Redis Streams Client
 * Handles Consumer Groups for distributed event processing
 */

import { getRedisClient } from '../database/redis.client.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('redis-streams');

// Stream configuration
export const STREAM_NAME = 'events_stream';
export const CONSUMER_GROUP = 'event_processors';
export const METRICS_KEY = 'metrics:realtime';

export interface StreamEvent {
  id: string;  // Redis stream message ID
  eventId: string;
  userId: string;
  eventType: string;
  payload: string;  // JSON stringified
  timestamp: string;
  priority: string;
  metadata?: string;
}

export interface StreamMessage {
  messageId: string;
  fields: Record<string, string>;
}

/**
 * Initialize the consumer group for the stream
 * Creates the stream and group if they don't exist
 */
export async function initializeConsumerGroup(): Promise<void> {
  const redis = getRedisClient();

  try {
    // Try to create the consumer group
    // MKSTREAM creates the stream if it doesn't exist
    await redis.xgroup('CREATE', STREAM_NAME, CONSUMER_GROUP, '0', 'MKSTREAM');
    logger.info({ stream: STREAM_NAME, group: CONSUMER_GROUP }, 'Consumer group created');
  } catch (error) {
    // Check if group already exists (this is expected in most cases)
    if (error instanceof Error && error.message.includes('BUSYGROUP')) {
      logger.info({ stream: STREAM_NAME, group: CONSUMER_GROUP }, 'Consumer group already exists');
    } else {
      throw error;
    }
  }
}

/**
 * Read messages from the stream using consumer group
 * Uses XREADGROUP for distributed processing
 */
export async function readFromStream(
  consumerId: string,
  count: number = 100,
  blockMs: number = 1000
): Promise<StreamMessage[]> {
  const redis = getRedisClient();

  // XREADGROUP reads messages assigned to this consumer
  // '>' means only new messages (not already delivered to others)
  const result = await redis.xreadgroup(
    'GROUP', CONSUMER_GROUP,
    consumerId,
    'COUNT', count,
    'BLOCK', blockMs,
    'STREAMS', STREAM_NAME,
    '>'  // Only new messages
  ) as [string, [string, string[]][]][] | null;

  if (!result || result.length === 0) {
    return [];
  }

  const messages: StreamMessage[] = [];
  
  // Parse the Redis response format
  // result = [[streamName, [[messageId, [field, value, ...]], ...]]]
  for (const [, streamMessages] of result) {
    for (const [messageId, fields] of streamMessages) {
      const fieldMap: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        const key = fields[i];
        const value = fields[i + 1];
        if (key !== undefined && value !== undefined) {
          fieldMap[key] = value;
        }
      }
      messages.push({ messageId, fields: fieldMap });
    }
  }

  return messages;
}

/**
 * Acknowledge processed messages
 * This removes them from the pending entries list
 */
export async function acknowledgeMessages(messageIds: string[]): Promise<number> {
  if (messageIds.length === 0) return 0;

  const redis = getRedisClient();
  const result = await redis.xack(STREAM_NAME, CONSUMER_GROUP, ...messageIds);
  
  return result;
}

/**
 * Add event to the stream (used by ingestion API)
 */
export async function addToStream(event: Omit<StreamEvent, 'id'>): Promise<string> {
  const redis = getRedisClient();

  const args: string[] = [
    STREAM_NAME,
    '*',  // Auto-generate ID
    'eventId', event.eventId,
    'userId', event.userId,
    'eventType', event.eventType,
    'payload', event.payload,
    'timestamp', event.timestamp,
    'priority', event.priority,
  ];

  if (event.metadata) {
    args.push('metadata', event.metadata);
  }

  const messageId = await redis.xadd(...(args as [string, string, ...string[]]));

  return messageId as string;
}

/**
 * Get stream info for monitoring
 */
export async function getStreamInfo(): Promise<{
  length: number;
  groups: number;
  pendingMessages: number;
}> {
  const redis = getRedisClient();

  const length = await redis.xlen(STREAM_NAME);
  
  let groups = 0;
  let pendingMessages = 0;

  try {
    const groupInfo = await redis.xinfo('GROUPS', STREAM_NAME) as Array<Array<string | number>>;
    groups = groupInfo.length;
    
    for (const group of groupInfo) {
      // Find pending count in the group info array
      const pendingIndex = group.indexOf('pending');
      if (pendingIndex !== -1 && typeof group[pendingIndex + 1] === 'number') {
        pendingMessages += group[pendingIndex + 1] as number;
      }
    }
  } catch {
    // Stream might not exist yet
  }

  return { length, groups, pendingMessages };
}

/**
 * Claim stale messages from other consumers (for recovery)
 * Messages older than minIdleTime will be claimed
 */
export async function claimStaleMessages(
  consumerId: string,
  minIdleTimeMs: number = 60000,
  count: number = 100
): Promise<StreamMessage[]> {
  const redis = getRedisClient();

  try {
    // Use XAUTOCLAIM for automatic claiming of idle messages
    const result = await redis.xautoclaim(
      STREAM_NAME,
      CONSUMER_GROUP,
      consumerId,
      minIdleTimeMs,
      '0-0',  // Start from beginning of pending list
      'COUNT', count
    ) as [string, Array<[string, string[]]>, string[]];

    const [, messages] = result;
    
    return messages.map(([messageId, fields]) => {
      const fieldMap: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        const key = fields[i];
        const value = fields[i + 1];
        if (key !== undefined && value !== undefined) {
          fieldMap[key] = value;
        }
      }
      return { messageId, fields: fieldMap };
    });
  } catch {
    // XAUTOCLAIM might not be available in older Redis versions
    return [];
  }
}
