/**
 * API Key Authentication Middleware
 * Optimized for high-throughput (50k EPS) with Redis caching
 * 
 * Flow:
 * 1. Check Redis cache first
 * 2. If miss, query PostgreSQL via Prisma
 * 3. Cache valid key in Redis with 1-hour TTL
 */

import crypto from 'crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { getRedisClient } from '../../database/redis.client.js';
import { getPrismaClient } from '../../database/postgres.client.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('apikey-middleware');

// Cache TTL: 1 hour (for the next 49,999+ requests)
const API_KEY_CACHE_TTL = 3600;
const API_KEY_PREFIX = 'evp_';

// Redis key prefix for API key cache
const CACHE_KEY_PREFIX = 'auth:apikey:';

export interface ApiKeyPayload {
  userId: string;
  email: string;
  role: string;
  keyId: string;
}

// Extend FastifyRequest to include API key payload
declare module 'fastify' {
  interface FastifyRequest {
    apiKeyPayload?: ApiKeyPayload;
  }
}

/**
 * Hash API key for secure comparison and caching
 */
function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Get cached API key data from Redis
 */
async function getCachedApiKey(keyHash: string): Promise<ApiKeyPayload | null> {
  const redis = getRedisClient();
  const cacheKey = `${CACHE_KEY_PREFIX}${keyHash}`;
  
  const cached = await redis.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as ApiKeyPayload;
    } catch {
      // Invalid cache data, will be refreshed
      return null;
    }
  }
  
  return null;
}

/**
 * Cache API key data in Redis
 */
async function cacheApiKey(keyHash: string, payload: ApiKeyPayload): Promise<void> {
  const redis = getRedisClient();
  const cacheKey = `${CACHE_KEY_PREFIX}${keyHash}`;
  
  await redis.setex(cacheKey, API_KEY_CACHE_TTL, JSON.stringify(payload));
}

/**
 * Validate API key against PostgreSQL (cache miss path)
 */
async function validateApiKeyFromDb(keyHash: string): Promise<ApiKeyPayload | null> {
  const prisma = getPrismaClient();
  
  const apiKeyRecord = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: { user: true },
  });

  if (!apiKeyRecord) {
    return null;
  }

  // Check if revoked
  if (apiKeyRecord.revokedAt) {
    logger.warn({ keyId: apiKeyRecord.id }, 'Revoked API key used');
    return null;
  }

  // Check expiration
  if (apiKeyRecord.expiresAt && apiKeyRecord.expiresAt < new Date()) {
    logger.warn({ keyId: apiKeyRecord.id }, 'Expired API key used');
    return null;
  }

  // Check user status
  if (apiKeyRecord.user.status !== 'ACTIVE') {
    logger.warn({ 
      keyId: apiKeyRecord.id, 
      userId: apiKeyRecord.userId,
      userStatus: apiKeyRecord.user.status 
    }, 'API key for inactive user');
    return null;
  }

  // Update last used (fire and forget - don't block request)
  prisma.apiKey.update({
    where: { id: apiKeyRecord.id },
    data: { lastUsedAt: new Date() },
  }).catch((err: Error) => {
    logger.error({ error: err.message, keyId: apiKeyRecord.id }, 'Failed to update lastUsedAt');
  });

  return {
    userId: apiKeyRecord.user.id,
    email: apiKeyRecord.user.email,
    role: apiKeyRecord.user.role,
    keyId: apiKeyRecord.id,
  };
}

/**
 * API Key authentication middleware
 * Validates x-api-key header with Redis cache + PostgreSQL fallback
 */
export async function authenticateApiKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const apiKey = request.headers['x-api-key'] as string | undefined;

  // Check header presence
  if (!apiKey) {
    return reply.status(401).send({
      success: false,
      error: {
        code: 'MISSING_API_KEY',
        message: 'x-api-key header is required',
      },
    });
  }

  // Validate API key format
  if (!apiKey.startsWith(API_KEY_PREFIX)) {
    return reply.status(401).send({
      success: false,
      error: {
        code: 'INVALID_API_KEY',
        message: 'Invalid API key format',
      },
    });
  }

  const keyHash = hashApiKey(apiKey);

  // Try cache first (fast path for 99.9% of requests)
  let payload = await getCachedApiKey(keyHash);

  if (!payload) {
    // Cache miss - query database
    logger.debug({ keyHash: keyHash.substring(0, 8) }, 'API key cache miss, querying database');
    
    payload = await validateApiKeyFromDb(keyHash);
    
    if (!payload) {
      logger.warn({ keyHash: keyHash.substring(0, 8) }, 'Invalid API key');
      return reply.status(401).send({
        success: false,
        error: {
          code: 'INVALID_API_KEY',
          message: 'Invalid or expired API key',
        },
      });
    }

    // Cache for future requests
    await cacheApiKey(keyHash, payload);
    logger.debug({ keyHash: keyHash.substring(0, 8) }, 'API key cached');
  }

  // Attach payload to request for downstream use
  request.apiKeyPayload = payload;
}

/**
 * Optional API key authentication - doesn't fail if not present
 */
export async function optionalApiKeyAuth(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const apiKey = request.headers['x-api-key'] as string | undefined;

  if (!apiKey || !apiKey.startsWith(API_KEY_PREFIX)) {
    return;
  }

  const keyHash = hashApiKey(apiKey);
  
  let payload = await getCachedApiKey(keyHash);
  
  if (!payload) {
    payload = await validateApiKeyFromDb(keyHash);
    if (payload) {
      await cacheApiKey(keyHash, payload);
    }
  }

  if (payload) {
    request.apiKeyPayload = payload;
  }
}
