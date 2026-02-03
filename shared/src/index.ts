// Shared types and utilities for Event Processor System
// High-scale event processing (50k EPS target)

// Export user types first (UserId is defined here)
export {
  type UserId,
  UserStatus,
  UserRole,
  type User,
  type CreateUserPayload,
  type UpdateUserPayload,
  type CachedApiKey,
} from './types/user.types.js';

// Export event types
export {
  type EventId,
  EventPriority,
  EventStatus,
  type EventPayload,
  type IngestEvent,
  type EventMetadata,
  type StoredEvent,
  type BatchProcessingResult,
  type BatchError,
  type RedisStreamEvent,
} from './types/event.types.js';

// Export API types
export {
  type ApiResponse,
  type ApiError,
  type ApiMeta,
  type PaginationMeta,
  type HealthCheckResponse,
  type ServiceHealth,
  type ServiceHealthMap,
  type MetricsResponse,
  type IngestEventRequest,
  type BatchIngestRequest,
  type IngestResponse,
  type BatchIngestResponse,
  type IngestError,
  type QueryEventsRequest,
  type QueryEventsResponse,
} from './types/api.types.js';
