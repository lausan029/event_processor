/**
 * Event Validation Service
 * Uses AJV for high-performance JSON schema validation
 */

import AjvLib from 'ajv';
import addFormatsLib from 'ajv-formats';
import type { JSONSchemaType, ValidateFunction } from 'ajv';
import { createLogger } from '../../infrastructure/logging/logger.js';

const logger = createLogger('event-validator');

// Handle ESM default exports
const Ajv = AjvLib.default ?? AjvLib;
const addFormats = addFormatsLib.default ?? addFormatsLib;

// Initialize AJV with performance optimizations
const ajv = new Ajv({
  allErrors: false,      // Stop on first error for speed
  coerceTypes: false,    // Strict types
  useDefaults: true,     // Apply defaults
  removeAdditional: true, // Strip unknown fields
  strict: true,
});

// Add format validators (uuid, date-time, etc.)
addFormats(ajv);

/**
 * Event payload structure for ingestion
 */
export interface IngestEventPayload {
  eventId?: string;          // Optional - will be generated if not provided
  eventType: string;         // Required - type of event (click, purchase, etc.)
  userId: string;            // Required - user identifier (shard key!)
  sessionId: string;         // Required - session identifier
  timestamp: string;         // Required - ISO 8601 datetime
  metadata?: Record<string, unknown>; // Optional - additional data
  payload?: Record<string, unknown>;  // Optional - event-specific data
  priority?: number;         // Optional - 0-3 (default: 1)
}

/**
 * Batch event payload
 */
export interface BatchIngestPayload {
  events: IngestEventPayload[];
}

// JSON Schema for single event
const eventSchema: JSONSchemaType<IngestEventPayload> = {
  type: 'object',
  properties: {
    eventId: { 
      type: 'string', 
      minLength: 1,
      maxLength: 128,
      nullable: true,
    },
    eventType: { 
      type: 'string', 
      minLength: 1, 
      maxLength: 100,
      pattern: '^[a-zA-Z][a-zA-Z0-9_.-]*$',  // Must start with letter
    },
    userId: { 
      type: 'string', 
      minLength: 1, 
      maxLength: 128,
    },
    sessionId: { 
      type: 'string', 
      minLength: 1, 
      maxLength: 128,
    },
    timestamp: { 
      type: 'string',
      format: 'date-time',
    },
    metadata: { 
      type: 'object',
      nullable: true,
      additionalProperties: true,
    },
    payload: { 
      type: 'object',
      nullable: true,
      additionalProperties: true,
    },
    priority: { 
      type: 'integer',
      minimum: 0,
      maximum: 3,
      default: 1,
      nullable: true,
    },
  },
  required: ['eventType', 'userId', 'sessionId', 'timestamp'],
  additionalProperties: false,
};

// JSON Schema for batch events
const batchEventSchema: JSONSchemaType<BatchIngestPayload> = {
  type: 'object',
  properties: {
    events: {
      type: 'array',
      items: eventSchema,
      minItems: 1,
      maxItems: 1000,  // Max batch size
    },
  },
  required: ['events'],
  additionalProperties: false,
};

// Compile validators (done once at startup for performance)
const validateEvent: ValidateFunction<IngestEventPayload> = ajv.compile(eventSchema);
const validateBatch: ValidateFunction<BatchIngestPayload> = ajv.compile(batchEventSchema);

export interface ValidationResult<T> {
  valid: boolean;
  data?: T;
  error?: string;
}

/**
 * Validate single event payload
 */
export function validateEventPayload(data: unknown): ValidationResult<IngestEventPayload> {
  const valid = validateEvent(data);
  
  if (valid) {
    return { valid: true, data: data as IngestEventPayload };
  }

  const error = validateEvent.errors?.[0];
  const errorMessage = error 
    ? `${error.instancePath || 'body'} ${error.message}` 
    : 'Invalid event payload';

  logger.debug({ errors: validateEvent.errors }, 'Event validation failed');
  
  return { valid: false, error: errorMessage };
}

/**
 * Validate batch event payload
 */
export function validateBatchPayload(data: unknown): ValidationResult<BatchIngestPayload> {
  const valid = validateBatch(data);
  
  if (valid) {
    return { valid: true, data: data as BatchIngestPayload };
  }

  const error = validateBatch.errors?.[0];
  const errorMessage = error 
    ? `${error.instancePath || 'body'} ${error.message}` 
    : 'Invalid batch payload';

  logger.debug({ errors: validateBatch.errors }, 'Batch validation failed');
  
  return { valid: false, error: errorMessage };
}
