/**
 * Global test setup
 * Configures environment and utilities for all test suites
 */

import { vi, beforeAll, afterAll, afterEach } from 'vitest';

// Set test environment
process.env['NODE_ENV'] = 'test';
process.env['JWT_SECRET'] = 'test-jwt-secret-key-for-testing';
process.env['LOG_LEVEL'] = 'silent';

// Mock timers for consistent testing
beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterAll(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.clearAllMocks();
});

// Global test utilities
export const createMockEvent = (overrides: Partial<{
  eventId: string;
  eventType: string;
  userId: string;
  sessionId: string;
  timestamp: string;
  metadata: Record<string, unknown>;
  payload: Record<string, unknown>;
  priority: number;
}> = {}) => ({
  eventId: overrides.eventId ?? `evt_test_${Date.now()}`,
  eventType: overrides.eventType ?? 'test_event',
  userId: overrides.userId ?? `user_${Math.random().toString(36).substring(7)}`,
  sessionId: overrides.sessionId ?? `sess_${Math.random().toString(36).substring(7)}`,
  timestamp: overrides.timestamp ?? new Date().toISOString(),
  metadata: overrides.metadata ?? {},
  payload: overrides.payload ?? {},
  priority: overrides.priority ?? 1,
});

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
