/**
 * Event Processor Backend - Entry Point
 */

import { createServer } from './infrastructure/http/server.js';
import { createLogger } from './infrastructure/logging/logger.js';
import { loadConfig, validateConfig } from './config/index.js';
import { closeRedisClient } from './infrastructure/database/redis.client.js';
import { closePrismaClient } from './infrastructure/database/postgres.client.js';
import { closeMongoClient } from './infrastructure/database/mongodb.client.js';

const logger = createLogger('main');

function formatError(error: unknown): { message: string; stack?: string; code?: string } {
  if (error instanceof Error) {
    const result: { message: string; stack?: string; code?: string } = {
      message: error.message,
    };
    if (error.stack) result.stack = error.stack;
    const code = (error as Error & { code?: string }).code;
    if (code) result.code = code;
    return result;
  }
  return { message: String(error) };
}

async function bootstrap(): Promise<void> {
  try {
    const config = loadConfig();
    const configErrors = validateConfig(config);
    
    if (configErrors.length > 0) {
      logger.fatal({ errors: configErrors }, 'Configuration errors');
      process.exit(1);
    }
    
    logger.info({ 
      env: config.env,
      host: config.server.host,
      port: config.server.port,
    }, 'Starting server');

    const server = await createServer(config);
    
    await server.listen({ 
      port: config.server.port, 
      host: config.server.host 
    });
    
    logger.info({ 
      url: `http://${config.server.host}:${config.server.port}` 
    }, 'Server listening');

    const shutdown = async (signal: string): Promise<void> => {
      logger.info({ signal }, 'Shutting down');
      
      try {
        await server.close();
        await closeRedisClient();
        await closePrismaClient();
        await closeMongoClient();
        logger.info('Shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error({ err: error }, 'Shutdown error');
        process.exit(1);
      }
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('uncaughtException', (error) => {
      logger.fatal({ err: error }, 'Uncaught exception');
      process.exit(1);
    });
    process.on('unhandledRejection', (reason) => {
      logger.fatal({ err: reason }, 'Unhandled rejection');
      process.exit(1);
    });

  } catch (error) {
    logger.fatal(formatError(error), 'Failed to start server');
    process.exit(1);
  }
}

void bootstrap();
