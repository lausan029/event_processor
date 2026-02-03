/**
 * Redis Client for Event Processor
 * Used for: Verification codes, API key cache, event deduplication, streams
 */

import RedisLib from 'ioredis';
import type { Redis as RedisType, RedisOptions } from 'ioredis';
import type { Config } from '../../config/index.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('redis-client');

const Redis = RedisLib.default ?? RedisLib;

let redisClient: RedisType | null = null;

export function createRedisClient(config: Config): RedisType {
  if (redisClient) {
    return redisClient;
  }

  const options: RedisOptions = {
    host: config.redis.host,
    port: config.redis.port,
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      if (times > 10) {
        logger.error({ attempts: times }, 'Redis connection failed');
        return null;
      }
      const delay = Math.min(times * 200, 5000);
      logger.warn({ attempt: times, delay }, 'Redis connection retry');
      return delay;
    },
    connectTimeout: 10000,
    commandTimeout: 5000,
    lazyConnect: true,
    enableReadyCheck: true,
  };

  if (config.redis.password) {
    options.password = config.redis.password;
  }

  redisClient = new Redis(options);

  redisClient.on('connect', () => {
    logger.debug('Redis TCP connection established');
  });

  redisClient.on('ready', () => {
    logger.info('Redis ready');
  });

  redisClient.on('error', (error: Error) => {
    logger.error({ error: error.message }, 'Redis error');
  });

  redisClient.on('close', () => {
    logger.warn('Redis connection closed');
  });

  redisClient.on('reconnecting', (delay: number) => {
    logger.warn({ delay }, 'Redis reconnecting');
  });

  return redisClient;
}

export function getRedisClient(): RedisType {
  if (!redisClient) {
    throw new Error('Redis client not initialized');
  }
  return redisClient;
}

export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis closed');
  }
}

export const RedisKeys = {
  verificationCode: (email: string) => `auth:verify:${email.toLowerCase()}`,
  apiKeyCache: (keyHash: string) => `auth:apikey:${keyHash}`,
  rateLimitAuth: (ip: string) => `ratelimit:auth:${ip}`,
  eventDedup: (eventId: string) => `dedup:event:${eventId}`,
} as const;
