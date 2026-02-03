/**
 * Core event types for the high-scale event processing system.
 * All events are sharded by hashed(userId) in MongoDB.
 */

// Import UserId from user.types to avoid duplication
import type { UserId } from './user.types.js';

// Re-export for convenience
export type { UserId };

/** Unique identifier for events */
export type EventId = string;

/** Event priority levels for processing order */
export enum EventPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3,
}

/** Event processing status */
export enum EventStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  PROCESSED = 'PROCESSED',
  FAILED = 'FAILED',
  DEAD_LETTER = 'DEAD_LETTER',
}

/** Base event payload structure */
export interface EventPayload {
  readonly [key: string]: unknown;
}

/**
 * Core event structure for ingestion.
 * eventId must be unique for idempotency (Redis SETNX check).
 */
export interface IngestEvent {
  readonly eventId: EventId;
  readonly userId: UserId;
  readonly eventType: string;
  readonly payload: EventPayload;
  readonly timestamp: Date;
  readonly priority?: EventPriority;
  readonly metadata?: EventMetadata;
}

/** Optional metadata attached to events */
export interface EventMetadata {
  readonly source?: string;
  readonly version?: string;
  readonly correlationId?: string;
  readonly traceId?: string;
}

/** Stored event in MongoDB (includes processing info) */
export interface StoredEvent extends IngestEvent {
  readonly _id: string;
  readonly status: EventStatus;
  readonly processedAt?: Date;
  readonly retryCount: number;
  readonly errorMessage?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Batch processing result */
export interface BatchProcessingResult {
  readonly processed: number;
  readonly failed: number;
  readonly eventIds: readonly EventId[];
  readonly errors: readonly BatchError[];
}

/** Error in batch processing */
export interface BatchError {
  readonly eventId: EventId;
  readonly message: string;
  readonly code: string;
}

/** Redis Stream entry format */
export interface RedisStreamEvent {
  readonly id: string;
  readonly eventId: EventId;
  readonly userId: UserId;
  readonly data: string; // JSON stringified IngestEvent
}
