/**
 * Fastify Server Configuration
 * Optimized for high-throughput event ingestion (50k EPS)
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { Config } from '../../config/index.js';
import { createLogger } from '../logging/logger.js';
import { createRedisClient } from '../database/redis.client.js';
import { createPrismaClient } from '../database/postgres.client.js';
import { createMongoClient } from '../database/mongodb.client.js';
import { healthRoutes } from './routes/health.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { metricsRoutes } from './routes/metrics.routes.js';
import { eventRoutes } from './routes/event.routes.js';
import { analyticsRoutes } from './routes/analytics.routes.js';

const logger = createLogger('http-server');

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Connect to Redis with retries
 */
async function connectRedisWithRetry(config: Config, maxRetries = 10): Promise<void> {
  const redis = createRedisClient(config);
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await redis.connect();
      const pingResult = await redis.ping();
      if (pingResult !== 'PONG') {
        throw new Error(`Redis ping failed: expected PONG, got ${pingResult}`);
      }
      logger.info('Redis connected');
      return;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn({ attempt, maxRetries, error: errorMessage }, 'Redis connection attempt failed');
      
      if (attempt === maxRetries) {
        throw new Error(`Redis connection failed after ${maxRetries} attempts: ${errorMessage}`);
      }
      
      await sleep(2000);
    }
  }
}

/**
 * Connect to PostgreSQL with retries
 */
async function connectPostgresWithRetry(maxRetries = 10): Promise<void> {
  const prisma = createPrismaClient();
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      logger.info('PostgreSQL connected');
      return;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn({ attempt, maxRetries, error: errorMessage }, 'PostgreSQL connection attempt failed');
      
      if (attempt === maxRetries) {
        throw new Error(`PostgreSQL connection failed after ${maxRetries} attempts: ${errorMessage}`);
      }
      
      // Disconnect before retry
      try {
        await prisma.$disconnect();
      } catch {
        // Ignore disconnect errors
      }
      
      await sleep(2000);
    }
  }
}

/**
 * Connect to MongoDB with retries
 */
async function connectMongoWithRetry(config: Config, maxRetries = 10): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mongo = await createMongoClient(config);
      await mongo.db(config.mongo.database).admin().ping();
      logger.info('MongoDB connected');
      return;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn({ attempt, maxRetries, error: errorMessage }, 'MongoDB connection attempt failed');
      
      if (attempt === maxRetries) {
        throw new Error(`MongoDB connection failed after ${maxRetries} attempts: ${errorMessage}`);
      }
      
      await sleep(2000);
    }
  }
}

export async function createServer(config: Config): Promise<FastifyInstance> {
  const server = Fastify({
    logger: false, // We use our own Pino logger
    trustProxy: true,
    // Optimize for high throughput
    connectionTimeout: 30000,
    keepAliveTimeout: 10000,
    maxParamLength: 100,
    // Increase body limit for batch requests
    bodyLimit: 10 * 1024 * 1024, // 10MB
  });

  // Initialize database connections with retry logic
  await connectRedisWithRetry(config);
  await connectPostgresWithRetry();
  await connectMongoWithRetry(config);

  // Swagger/OpenAPI documentation
  await server.register(swagger, {
    openapi: {
      info: {
        title: 'Event Processing API',
        description: 'High-scale event processing system (50k EPS)',
        version: '1.0.0',
      },
      servers: [
        { url: 'http://localhost:3001', description: 'Development' },
      ],
      components: {
        securitySchemes: {
          apiKey: {
            type: 'apiKey',
            name: 'x-api-key',
            in: 'header',
            description: 'API Key for event ingestion',
          },
        },
      },
      tags: [
        { name: 'Events', description: 'Event ingestion endpoints' },
        { name: 'Analytics', description: 'Analytics and metrics endpoints' },
        { name: 'Auth', description: 'Authentication endpoints' },
        { name: 'Health', description: 'Health check endpoints' },
      ],
    },
  });

  await server.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  // Security middleware
  await server.register(helmet, {
    contentSecurityPolicy: false, // Disable for API-only server
  });

  await server.register(cors, {
    origin: config.env === 'production' 
      ? ['https://yourdomain.com'] 
      : true,
    credentials: true,
  });

  // Rate limiting with different limits per route
  // Event ingestion has higher limits
  await server.register(rateLimit, {
    global: true,
    max: 1000,  // Default limit
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please slow down',
      },
    }),
  });

  // Request logging (skip for high-frequency event ingestion in production)
  server.addHook('onRequest', async (request) => {
    // Only log non-event requests or in development
    if (!request.url.includes('/v1/events') || config.env !== 'production') {
      logger.debug({
        method: request.method,
        url: request.url,
        requestId: request.id,
      }, 'Incoming request');
    }
  });

  server.addHook('onResponse', async (request, reply) => {
    // Only log non-event requests or in development
    if (!request.url.includes('/v1/events') || config.env !== 'production') {
      logger.info({
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime,
        requestId: request.id,
      }, 'Request completed');
    }
  });

  // Error handler
  server.setErrorHandler((error, request, reply) => {
    logger.error({
      error: error.message,
      stack: error.stack,
      requestId: request.id,
    }, 'Request error');

    void reply.status(error.statusCode ?? 500).send({
      success: false,
      error: {
        code: error.code ?? 'INTERNAL_ERROR',
        message: config.env === 'production' 
          ? 'An internal error occurred' 
          : error.message,
      },
    });
  });

  // Register routes
  await server.register(healthRoutes, { prefix: '/api' });
  await server.register(authRoutes, { prefix: '/api/auth' });
  await server.register(metricsRoutes, { prefix: '/api/metrics' });
  await server.register(eventRoutes, { prefix: '/api/v1' });
  await server.register(analyticsRoutes, { prefix: '/api/v1' });

  logger.info('Routes registered');
  return server;
}
