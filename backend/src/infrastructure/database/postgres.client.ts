/**
 * Prisma Client for PostgreSQL
 * Master data: Users, API Keys, Settings
 */

import { PrismaClient } from '@prisma/client';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('postgres-client');

let prismaClient: PrismaClient | null = null;

interface PrismaQueryEvent {
  timestamp: Date;
  query: string;
  params: string;
  duration: number;
  target: string;
}

interface PrismaLogEvent {
  timestamp: Date;
  message: string;
  target: string;
}

export function createPrismaClient(): PrismaClient {
  if (prismaClient) {
    return prismaClient;
  }

  prismaClient = new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });

  if (process.env['NODE_ENV'] !== 'production') {
    (prismaClient.$on as (event: string, callback: (e: PrismaQueryEvent) => void) => void)(
      'query',
      (e: PrismaQueryEvent) => {
        if (e.duration > 100) {
          logger.warn({ query: e.query.substring(0, 100), duration: e.duration }, 'Slow query');
        }
      }
    );
  }

  (prismaClient.$on as (event: string, callback: (e: PrismaLogEvent) => void) => void)(
    'error',
    (e: PrismaLogEvent) => {
      logger.error({ message: e.message }, 'Prisma error');
    }
  );

  return prismaClient;
}

export function getPrismaClient(): PrismaClient {
  if (!prismaClient) {
    throw new Error('Prisma client not initialized');
  }
  return prismaClient;
}

export async function closePrismaClient(): Promise<void> {
  if (prismaClient) {
    await prismaClient.$disconnect();
    prismaClient = null;
    logger.info('Prisma closed');
  }
}
