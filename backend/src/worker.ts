/**
 * Event Worker Entry Point
 * Standalone process that consumes events from Redis Streams
 * 
 * Run with: npm run worker
 * 
 * This process is stateless and can be scaled horizontally.
 * Each instance gets a unique consumer ID based on hostname.
 */

import { createLogger } from './infrastructure/logging/logger.js';
import { loadConfig } from './config/index.js';
import { createRedisClient, closeRedisClient } from './infrastructure/database/redis.client.js';
import { createMongoClient, closeMongoClient } from './infrastructure/database/mongodb.client.js';
import { startWorker } from './application/workers/event.worker.js';

const logger = createLogger('worker-main');

/**
 * Validate required environment variables
 */
function validateEnvironment(): void {
  const mongoUri = process.env['MONGO_URI'] || process.env['MONGO_URL'] || process.env['MONGODB_URL'];
  if (!mongoUri || mongoUri.trim() === '') {
    logger.error('Missing required environment variable: MONGO_URI');
    throw new Error('Missing required environment variable: MONGO_URI');
  }

  const redisUrl = process.env['REDIS_URL'];
  const redisHost = process.env['REDIS_HOST'];
  const redisPort = process.env['REDIS_PORT'];
  
  if (!redisUrl && (!redisHost || !redisPort)) {
    logger.error('Missing Redis configuration: REDIS_URL or (REDIS_HOST + REDIS_PORT)');
    throw new Error('Missing required environment variables: REDIS_URL or (REDIS_HOST + REDIS_PORT)');
  }
}

async function bootstrap(): Promise<void> {
  try {
    validateEnvironment();
    const config = loadConfig();

    logger.info({
      env: config.env,
      mongoUri: config.mongo.uri,
      redisHost: config.redis.host,
    }, 'Starting Event Worker');

    // Initialize connections
    logger.info('Connecting to Redis...');
    const redis = createRedisClient(config);
    await redis.connect();
    
    const pingResult = await redis.ping();
    logger.info({ pingResult }, 'Redis connected');

    logger.info('Connecting to MongoDB...');
    await createMongoClient(config);
    logger.info('MongoDB connected');

    // Start the worker
    const worker = await startWorker();
    logger.info('Worker started successfully');

    // Graceful shutdown
    const shutdown = async (signal: string): Promise<void> => {
      logger.info({ signal }, 'Received shutdown signal');

      await worker.stop();

      const stats = worker.getStats();
      logger.info({
        processedCount: stats.processedCount,
        errorCount: stats.errorCount,
      }, 'Final worker stats');

      await closeRedisClient();
      await closeMongoClient();

      logger.info('Worker shutdown complete');
      process.exit(0);
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));

    process.on('uncaughtException', (error) => {
      logger.fatal({ 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }, 'Uncaught exception - shutting down');
      void shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
      logger.fatal({ 
        reason: reason instanceof Error ? reason.message : String(reason),
      }, 'Unhandled rejection - shutting down');
      void shutdown('unhandledRejection');
    });

  } catch (error) {
    logger.fatal({ 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }, 'Failed to start worker');
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    process.exit(1);
  }
}

void bootstrap();
