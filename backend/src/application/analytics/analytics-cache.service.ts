/**
 * Analytics Cache Service
 * Implements Redis caching for analytics metrics to reduce MongoDB load
 * TTL: 10 seconds to handle high-frequency dashboard refreshes
 */

import { getRedisClient } from '../../infrastructure/database/redis.client.js';
import { createLogger } from '../../infrastructure/logging/logger.js';
import type { AnalyticsMetrics } from './analytics.service.js';

const logger = createLogger('analytics-cache');

const CACHE_PREFIX = 'analytics:cache:';
const CACHE_TTL = 10; // 10 seconds

/**
 * Generate cache key from filters
 */
export function generateCacheKey(
  timeRange: string,
  eventTypeFilter?: string,
  userIdFilter?: string
): string {
  const parts = [CACHE_PREFIX, timeRange];
  
  if (eventTypeFilter) {
    parts.push(`et:${eventTypeFilter}`);
  }
  
  if (userIdFilter) {
    parts.push(`uid:${userIdFilter}`);
  }
  
  return parts.join(':');
}

/**
 * Get cached analytics metrics
 */
export async function getCachedMetrics(
  timeRange: string,
  eventTypeFilter?: string,
  userIdFilter?: string
): Promise<AnalyticsMetrics | null> {
  const redis = getRedisClient();
  const cacheKey = generateCacheKey(timeRange, eventTypeFilter, userIdFilter);
  
  try {
    const cached = await redis.get(cacheKey);
    
    if (cached) {
      logger.debug({ cacheKey }, 'Cache HIT for analytics metrics');
      return JSON.parse(cached) as AnalyticsMetrics;
    }
    
    logger.debug({ cacheKey }, 'Cache MISS for analytics metrics');
    return null;
  } catch (error) {
    logger.warn({ 
      error: error instanceof Error ? error.message : String(error),
      cacheKey,
    }, 'Failed to get cached metrics');
    return null;
  }
}

/**
 * Cache analytics metrics
 */
export async function cacheMetrics(
  metrics: AnalyticsMetrics,
  timeRange: string,
  eventTypeFilter?: string,
  userIdFilter?: string
): Promise<void> {
  const redis = getRedisClient();
  const cacheKey = generateCacheKey(timeRange, eventTypeFilter, userIdFilter);
  
  try {
    await redis.setex(
      cacheKey,
      CACHE_TTL,
      JSON.stringify(metrics)
    );
    
    logger.debug({ 
      cacheKey, 
      ttl: CACHE_TTL,
      totalEvents: metrics.totalEvents,
    }, 'Cached analytics metrics');
  } catch (error) {
    logger.warn({ 
      error: error instanceof Error ? error.message : String(error),
      cacheKey,
    }, 'Failed to cache metrics');
    // Don't throw - caching is optional
  }
}

/**
 * Invalidate analytics cache (e.g., when new events are ingested)
 */
export async function invalidateAnalyticsCache(): Promise<void> {
  const redis = getRedisClient();
  
  try {
    // Get all keys matching the pattern
    const keys = await redis.keys(`${CACHE_PREFIX}*`);
    
    if (keys.length > 0) {
      await redis.del(...keys);
      logger.debug({ count: keys.length }, 'Invalidated analytics cache');
    }
  } catch (error) {
    logger.warn({ 
      error: error instanceof Error ? error.message : String(error),
    }, 'Failed to invalidate analytics cache');
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{
  totalKeys: number;
  keys: string[];
}> {
  const redis = getRedisClient();
  
  try {
    const keys = await redis.keys(`${CACHE_PREFIX}*`);
    
    return {
      totalKeys: keys.length,
      keys,
    };
  } catch (error) {
    logger.warn({ 
      error: error instanceof Error ? error.message : String(error),
    }, 'Failed to get cache stats');
    
    return {
      totalKeys: 0,
      keys: [],
    };
  }
}
