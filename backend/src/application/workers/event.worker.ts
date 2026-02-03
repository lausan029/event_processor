/**
 * Event Worker Service
 * Consumes events from Redis Streams and bulk-writes to MongoDB
 * 
 * Key features:
 * - Consumer Groups for horizontal scaling
 * - Batching with backpressure control
 * - Exponential backoff with jitter for retries
 * - Dead Letter Queue for permanent failures
 * - Real-time metrics updates
 */

import os from 'os';
import { createLogger } from '../../infrastructure/logging/logger.js';
import {
  readFromStream,
  acknowledgeMessages,
  claimStaleMessages,
  initializeConsumerGroup,
  type StreamMessage,
} from '../../infrastructure/streams/redis-stream.client.js';
import {
  bulkWriteEvents,
  writeToDeadLetterQueue,
  type StoredEvent,
  type DeadLetterEvent,
} from '../../infrastructure/database/mongodb.client.js';
import {
  updateBatchMetrics,
  recordFailedEvents,
  recordDLQEvents,
} from '../metrics/metrics.service.js';
import { withRetry, DEFAULT_RETRY_CONFIG } from './retry.utils.js';

const logger = createLogger('event-worker');

// Worker Configuration
const BATCH_SIZE = 100;
const BATCH_TIMEOUT_MS = 500;
const READ_BLOCK_MS = 100;
const READ_COUNT = 50;
const CLAIM_INTERVAL_MS = 30000;
const STALE_MESSAGE_AGE_MS = 60000;
const MEMORY_LOG_INTERVAL = 500;

interface WorkerState {
  consumerId: string;
  isRunning: boolean;
  eventBuffer: BufferedEvent[];
  lastFlushTime: number;
  processedCount: number;
  errorCount: number;
  lastMemoryLog: number;
  isProcessing: boolean;  // Backpressure flag - prevents reading while writing
}

interface BufferedEvent {
  messageId: string;
  event: StoredEvent;
  rawMessage: StreamMessage;
}

/**
 * Generate unique consumer ID using hostname + process ID
 */
function generateConsumerId(): string {
  const hostname = os.hostname();
  const pid = process.pid;
  const random = Math.random().toString(36).substring(2, 8);
  return `worker-${hostname}-${pid}-${random}`;
}

/**
 * Parse stream message into StoredEvent
 */
function parseStreamMessage(message: StreamMessage): StoredEvent | null {
  try {
    const { fields } = message;
    
    if (!fields['eventId'] || !fields['userId']) {
      logger.warn({ messageId: message.messageId }, 'Invalid message: missing required fields');
      return null;
    }

    let payload: Record<string, unknown> = {};
    if (fields['payload']) {
      try {
        payload = JSON.parse(fields['payload']) as Record<string, unknown>;
      } catch {
        payload = { raw: fields['payload'] };
      }
    }

    let metadata: Record<string, unknown> = {};
    if (fields['metadata']) {
      try {
        metadata = JSON.parse(fields['metadata']) as Record<string, unknown>;
      } catch {
        metadata = { raw: fields['metadata'] };
      }
    }

    const event: StoredEvent = {
      eventId: fields['eventId'],
      userId: fields['userId'],  // Critical for sharding!
      eventType: fields['eventType'] ?? 'unknown',
      payload,
      timestamp: new Date(fields['timestamp'] ?? Date.now()),
      priority: parseInt(fields['priority'] ?? '1', 10),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      status: 'PROCESSED',
      processedAt: new Date(),
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return event;
  } catch (error) {
    logger.error({ 
      messageId: message.messageId, 
      error 
    }, 'Failed to parse stream message');
    return null;
  }
}

function logMemoryUsage(state: WorkerState): void {
  if (state.processedCount - state.lastMemoryLog >= MEMORY_LOG_INTERVAL) {
    const mem = process.memoryUsage();
    logger.debug({
      processedCount: state.processedCount,
      rssMB: Math.round(mem.rss / 1024 / 1024),
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
    }, 'Memory checkpoint');
    state.lastMemoryLog = state.processedCount;
  }
}

/**
 * Allow Event Loop to breathe between batches
 */
function breathe(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

/**
 * Flush buffer to MongoDB with backpressure control
 */
async function flushBuffer(state: WorkerState): Promise<void> {
  if (state.eventBuffer.length === 0) {
    return;
  }

  // Set backpressure flag - prevent reading while writing
  state.isProcessing = true;

  // Move buffer to local variable and clear immediately to free memory
  const batchToProcess = state.eventBuffer;
  state.eventBuffer = [];  // Clear buffer immediately
  state.lastFlushTime = Date.now();

  // Extract only what we need, don't keep references
  const events: StoredEvent[] = [];
  const messageIds: string[] = [];
  const eventTypes: string[] = [];
  
  for (const item of batchToProcess) {
    events.push(item.event);
    messageIds.push(item.messageId);
    eventTypes.push(item.event.eventType);
  }
  
  // Clear the batch array to help GC
  batchToProcess.length = 0;

  const startTime = Date.now();

  logger.info({
    batchSize: events.length,
    consumerId: state.consumerId
  }, 'Processing batch');

  try {
    // BACKPRESSURE: Wait for bulkWrite to complete before continuing
    const result = await withRetry(
      () => bulkWriteEvents(events),
      'bulkWriteEvents',
      DEFAULT_RETRY_CONFIG
    );

    const processingTime = Date.now() - startTime;

    if (result.success) {
      // Acknowledge messages in Redis - wait for completion
      await acknowledgeMessages(messageIds);

      // Update metrics
      await updateBatchMetrics(events.length, eventTypes, processingTime);

      state.processedCount += events.length;
      
      // Log memory periodically
      logMemoryUsage(state);

      logger.info({
        batchSize: events.length,
        processingTimeMs: processingTime,
        totalProcessed: state.processedCount,
        consumerId: state.consumerId
      }, 'Batch processed successfully');

    } else {
      // All retries failed - move to Dead Letter Queue
      logger.error({
        batchSize: events.length,
        error: result.error?.message,
        attempts: result.attempts,
        consumerId: state.consumerId
      }, 'CRITICAL: Batch failed after all retries, moving to DLQ');

      const dlqEvents: DeadLetterEvent[] = events.map((event, index) => ({
        originalEventId: event.eventId,
        userId: event.userId,
        eventData: {
          eventType: event.eventType,
          payload: event.payload,
          timestamp: event.timestamp,
          metadata: event.metadata,
        },
        errorMessage: result.error?.message ?? 'Unknown error',
        failedAt: new Date(),
        retryCount: result.attempts,
        streamMessageId: messageIds[index] ?? `unknown-${index}`,
      }));

      try {
        await writeToDeadLetterQueue(dlqEvents);
        await recordDLQEvents(dlqEvents.length);
        
        // Still acknowledge to prevent reprocessing
        await acknowledgeMessages(messageIds);
      } catch (dlqError) {
        logger.fatal({
          error: dlqError,
          messageIds,
          consumerId: state.consumerId
        }, 'FATAL: Failed to write to DLQ - messages will be reprocessed');
      }

      state.errorCount += events.length;
      await recordFailedEvents(events.length);
    }
  } finally {
    // Always release backpressure flag
    state.isProcessing = false;
    
    // Allow Event Loop to breathe
    await breathe();
  }
}

/**
 * Process incoming messages with backpressure
 */
async function processMessages(
  state: WorkerState,
  messages: StreamMessage[]
): Promise<void> {
  for (const message of messages) {
    const event = parseStreamMessage(message);
    
    if (event) {
      state.eventBuffer.push({
        messageId: message.messageId,
        event,
        rawMessage: message,
      });
    } else {
      // Invalid message - acknowledge to remove from stream
      await acknowledgeMessages([message.messageId]);
    }
    
    // Clear reference to message after processing
    // This helps GC reclaim memory faster
  }

  // Check if we should flush - ALWAYS flush when batch is full
  // This implements backpressure by blocking until write completes
  const shouldFlush = 
    state.eventBuffer.length >= BATCH_SIZE ||
    (state.eventBuffer.length > 0 && Date.now() - state.lastFlushTime >= BATCH_TIMEOUT_MS);

  if (shouldFlush) {
    await flushBuffer(state);  // Blocks until MongoDB write completes
  }
}

/**
 * Main worker loop with backpressure and memory management
 */
async function workerLoop(state: WorkerState): Promise<void> {
  let lastClaimTime = Date.now();

  while (state.isRunning) {
    try {
      // BACKPRESSURE: Don't read if we're still processing a write
      if (state.isProcessing) {
        await new Promise(resolve => setTimeout(resolve, 50));
        continue;
      }

      // Read new messages - limited count for memory control
      const messages = await readFromStream(
        state.consumerId,
        READ_COUNT,
        READ_BLOCK_MS
      );

      if (messages.length > 0) {
        // Process and potentially flush - this blocks until write completes
        await processMessages(state, messages);
        
        // Allow Event Loop to breathe after processing
        await breathe();
      } else {
        // No new messages - check if we need to flush due to timeout
        if (
          state.eventBuffer.length > 0 &&
          Date.now() - state.lastFlushTime >= BATCH_TIMEOUT_MS
        ) {
          await flushBuffer(state);
        }
        
        // Small delay when idle to prevent tight loop
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Periodically claim stale messages from dead consumers
      if (Date.now() - lastClaimTime >= CLAIM_INTERVAL_MS) {
        const staleMessages = await claimStaleMessages(
          state.consumerId,
          STALE_MESSAGE_AGE_MS
        );

        if (staleMessages.length > 0) {
          logger.info({
            count: staleMessages.length,
            consumerId: state.consumerId
          }, 'Claimed stale messages');
          
          await processMessages(state, staleMessages);
        }

        lastClaimTime = Date.now();
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error({
        error: errorMessage,
        consumerId: state.consumerId,
        bufferSize: state.eventBuffer.length,
      }, 'Error in worker loop');

      // Clear buffer on error to prevent memory buildup
      if (state.eventBuffer.length > 0) {
        logger.warn({
          consumerId: state.consumerId,
          droppedEvents: state.eventBuffer.length
        }, 'Clearing buffer due to error - events will be redelivered');
        state.eventBuffer = [];
      }

      // Exponential backoff on errors
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // Final flush on shutdown
  if (state.eventBuffer.length > 0) {
    logger.info({ 
      remainingEvents: state.eventBuffer.length,
      consumerId: state.consumerId 
    }, 'Flushing remaining events before shutdown');
    try {
      await flushBuffer(state);
    } catch (error) {
      logger.error({
        error,
        consumerId: state.consumerId,
        lostEvents: state.eventBuffer.length
      }, 'Failed to flush on shutdown - events will be redelivered');
    }
  }
}

/**
 * Start the event worker with graceful shutdown
 */
export async function startWorker(): Promise<{
  stop: () => Promise<void>;
  getStats: () => { processedCount: number; errorCount: number };
}> {
  const consumerId = generateConsumerId();

  logger.info({ consumerId }, 'Starting event worker');

  // Initialize consumer group
  await initializeConsumerGroup();

  const state: WorkerState = {
    consumerId,
    isRunning: true,
    eventBuffer: [],
    lastFlushTime: Date.now(),
    processedCount: 0,
    errorCount: 0,
    lastMemoryLog: 0,
    isProcessing: false,
  };

  logger.info({
    consumerId,
    batchSize: BATCH_SIZE,
    readCount: READ_COUNT,
    batchTimeoutMs: BATCH_TIMEOUT_MS,
  }, 'Worker initialized');

  // Start the worker loop
  const loopPromise = workerLoop(state);

  // Graceful shutdown handler
  const gracefulStop = async (): Promise<void> => {
    logger.info({ consumerId }, 'Stopping event worker gracefully');
    state.isRunning = false;
    
    // Wait for loop to finish (with timeout)
    const timeout = new Promise<void>(resolve => setTimeout(resolve, 5000));
    await Promise.race([loopPromise, timeout]);
    
    logger.info({
      consumerId,
      totalProcessed: state.processedCount,
      totalErrors: state.errorCount,
    }, 'Worker stopped');
  };

  return {
    stop: gracefulStop,
    getStats: () => ({
      processedCount: state.processedCount,
      errorCount: state.errorCount,
    }),
  };
}
