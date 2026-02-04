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
  console.log('[WORKER] ========================================');
  console.log('[WORKER] Environment Variable Validation');
  console.log('[WORKER] ========================================');
  
  // Check MongoDB URI (multiple possible names)
  const mongoUri = process.env['MONGO_URI'] || process.env['MONGO_URL'] || process.env['MONGODB_URL'];
  if (!mongoUri || mongoUri.trim() === '') {
    console.error('[WORKER] ❌ Missing MONGO_URI (or MONGO_URL/MONGODB_URL)');
    console.error('[WORKER] Please set MONGO_URI environment variable');
    throw new Error('Missing required environment variable: MONGO_URI');
  }
  console.log(`[WORKER] ✅ MONGO_URI: ${mongoUri.length > 50 ? mongoUri.substring(0, 30) + '...' : mongoUri}`);

  // Check Redis connection (can be URL or HOST+PORT)
  const redisUrl = process.env['REDIS_URL'];
  const redisHost = process.env['REDIS_HOST'];
  const redisPort = process.env['REDIS_PORT'];
  
  if (!redisUrl && (!redisHost || !redisPort)) {
    console.error('[WORKER] ❌ Missing Redis configuration');
    console.error('[WORKER] Please set either:');
    console.error('  - REDIS_URL (e.g., redis://redis:6379)');
    console.error('  - OR REDIS_HOST + REDIS_PORT');
    throw new Error('Missing required environment variables: REDIS_URL or (REDIS_HOST + REDIS_PORT)');
  }
  
  if (redisUrl) {
    console.log(`[WORKER] ✅ REDIS_URL: ${redisUrl.length > 50 ? redisUrl.substring(0, 30) + '...' : redisUrl}`);
  } else {
    console.log(`[WORKER] ✅ REDIS_HOST: ${redisHost}`);
    console.log(`[WORKER] ✅ REDIS_PORT: ${redisPort}`);
  }

  console.log('[WORKER] ========================================');
  console.log('[WORKER] ✅ All required environment variables validated');
  console.log('[WORKER] ========================================');
}

async function bootstrap(): Promise<void> {
  try {
    // Validate environment variables FIRST
    validateEnvironment();

    console.log('[WORKER] Loading configuration...');
    const config = loadConfig();

    logger.info({
      env: config.env,
      mongoUri: config.mongo.uri,
      redisHost: config.redis.host,
    }, 'Starting Event Worker');

    // Initialize connections
    console.log('[WORKER] ========================================');
    console.log('[WORKER] Starting connection sequence...');
    console.log('[WORKER] ========================================');
    
    console.log('[WORKER] Step 1/2: Connecting to Redis...');
    console.log(`[WORKER] Redis URL: ${config.redis.url || `${config.redis.host}:${config.redis.port}`}`);
    logger.info('Connecting to Redis...');
    
    try {
      const redis = createRedisClient(config);
      console.log('[WORKER] Redis client created, attempting connection...');
      await redis.connect();
      console.log('[WORKER] Redis connection established');
      
      // Verify Redis connection
      console.log('[WORKER] Verifying Redis connection with PING...');
      const pingResult = await redis.ping();
      console.log(`[WORKER] ✅ Redis PING: ${pingResult}`);
      logger.info({ pingResult }, 'Redis connection verified');
    } catch (redisError) {
      const errorMsg = redisError instanceof Error ? redisError.message : String(redisError);
      console.error(`[WORKER] ❌ Redis connection failed: ${errorMsg}`);
      throw new Error(`Redis connection failed: ${errorMsg}`);
    }

    console.log('[WORKER] Step 2/2: Connecting to MongoDB...');
    console.log(`[WORKER] MongoDB URI: ${config.mongo.uri.substring(0, 30)}...`);
    logger.info('Connecting to MongoDB...');
    
    try {
      console.log('[WORKER] Creating MongoDB client...');
      await createMongoClient(config);
      console.log('[WORKER] ✅ MongoDB client created and connected');
    } catch (mongoError) {
      const errorMsg = mongoError instanceof Error ? mongoError.message : String(mongoError);
      console.error(`[WORKER] ❌ MongoDB connection failed: ${errorMsg}`);
      throw new Error(`MongoDB connection failed: ${errorMsg}`);
    }

    console.log('[WORKER] Starting event worker...');
    // Start the worker
    const worker = await startWorker();
    
    console.log('[WORKER] Worker started successfully. Waiting for events...');

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
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    console.error('[WORKER] ========================================');
    console.error('[WORKER] ❌ FATAL ERROR - Worker failed to start');
    console.error('[WORKER] ========================================');
    console.error(`[WORKER] Error: ${errorMessage}`);
    if (errorStack) {
      console.error(`[WORKER] Stack:\n${errorStack}`);
    }
    
    const mem = process.memoryUsage();
    logger.fatal({ 
      error: errorMessage,
      stack: errorStack,
      rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
    }, 'Failed to start worker');
    
    // Wait a bit before exiting to allow logs to flush
    await new Promise(resolve => setTimeout(resolve, 1000));
    process.exit(1);
  }
}

// Wrap bootstrap in top-level try/catch for extra safety
(async () => {
  try {
    await bootstrap();
  } catch (error) {
    console.error('[WORKER] Unhandled error in bootstrap:', error);
    process.exit(1);
  }
})();
