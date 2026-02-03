/**
 * API request/response types for the Event Processor API.
 * Designed for high-throughput ingestion (50k EPS).
 */

import type { IngestEvent, EventId } from './event.types.js';

/** Standard API response wrapper */
export interface ApiResponse<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: ApiError;
  readonly meta?: ApiMeta;
}

/** API error structure */
export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

/** API metadata (pagination, timing, etc.) */
export interface ApiMeta {
  readonly requestId: string;
  readonly timestamp: Date;
  readonly processingTimeMs?: number;
  readonly pagination?: PaginationMeta;
}

/** Pagination metadata */
export interface PaginationMeta {
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

/** Health check response */
export interface HealthCheckResponse {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly version: string;
  readonly uptime: number;
  readonly services: ServiceHealthMap;
}

/** Individual service health */
export interface ServiceHealth {
  readonly status: 'up' | 'down' | 'degraded';
  readonly latencyMs?: number;
  readonly message?: string;
}

/** Map of service health checks */
export interface ServiceHealthMap {
  readonly mongodb: ServiceHealth;
  readonly postgres: ServiceHealth;
  readonly redis: ServiceHealth;
}

/** Metrics response */
export interface MetricsResponse {
  readonly eventsPerSecond: number;
  readonly totalEventsProcessed: number;
  readonly averageLatencyMs: number;
  readonly queueDepth: number;
  readonly errorRate: number;
  readonly timestamp: Date;
}

/** Event ingestion request (single event) */
export interface IngestEventRequest {
  readonly event: IngestEvent;
}

/** Batch event ingestion request */
export interface BatchIngestRequest {
  readonly events: readonly IngestEvent[];
}

/** Ingestion response */
export interface IngestResponse {
  readonly accepted: boolean;
  readonly eventId: EventId;
  readonly message?: string;
}

/** Batch ingestion response */
export interface BatchIngestResponse {
  readonly accepted: number;
  readonly rejected: number;
  readonly eventIds: readonly EventId[];
  readonly errors?: readonly IngestError[];
}

/** Individual ingestion error */
export interface IngestError {
  readonly eventId: EventId;
  readonly code: string;
  readonly message: string;
}

/** Query events request */
export interface QueryEventsRequest {
  readonly userId?: string;
  readonly eventType?: string;
  readonly startDate?: Date;
  readonly endDate?: Date;
  readonly page?: number;
  readonly pageSize?: number;
}

/** Query events response */
export interface QueryEventsResponse {
  readonly events: readonly IngestEvent[];
  readonly pagination: PaginationMeta;
}
