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

async function bootstrap(): Promise<void> {
  try {
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

    logger.info('Connecting to MongoDB...');
    await createMongoClient(config);

    // Start the worker
    const worker = await startWorker();

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

    // Handle uncaught errors without killing the process immediately
    process.on('uncaughtException', (error) => {
      const mem = process.memoryUsage();
      logger.fatal({ 
        error: error instanceof Error ? error.message : String(error),
        rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
      }, 'Uncaught exception - attempting graceful shutdown');
      void shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
      const mem = process.memoryUsage();
      logger.fatal({ 
        reason: reason instanceof Error ? reason.message : String(reason),
        rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
      }, 'Unhandled rejection - attempting graceful shutdown');
      void shutdown('unhandledRejection');
    });

  } catch (error) {
    const mem = process.memoryUsage();
    logger.fatal({ 
      error: error instanceof Error ? error.message : String(error),
      rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
    }, 'Failed to start worker');
    process.exit(1);
  }
}

void bootstrap();
