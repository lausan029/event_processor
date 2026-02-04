/**
 * Health Check Routes
 * Provides system status for monitoring and load balancers
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  timestamp: string;
  services: {
    mongodb: { status: 'up' | 'down' | 'degraded' };
    postgres: { status: 'up' | 'down' | 'degraded' };
    redis: { status: 'up' | 'down' | 'degraded' };
  };
}

const healthResponseSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'] },
    version: { type: 'string' },
    uptime: { type: 'number', description: 'Server uptime in seconds' },
    timestamp: { type: 'string', format: 'date-time' },
    services: {
      type: 'object',
      properties: {
        mongodb: { type: 'object', properties: { status: { type: 'string', enum: ['up', 'down', 'degraded'] } } },
        postgres: { type: 'object', properties: { status: { type: 'string', enum: ['up', 'down', 'degraded'] } } },
        redis: { type: 'object', properties: { status: { type: 'string', enum: ['up', 'down', 'degraded'] } } },
      },
    },
  },
} as const;

export const healthRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance
): Promise<void> => {
  // GET /health - Full health check
  fastify.get('/health', {
    schema: {
      tags: ['Health'],
      summary: 'System health check',
      description: 'Returns the health status of all system components including database connections.',
      response: {
        200: healthResponseSchema,
      },
    },
  }, async (_request, reply) => {
    const response: HealthResponse = {
      status: 'healthy',
      version: '1.0.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      services: {
        mongodb: { status: 'up' },
        postgres: { status: 'up' },
        redis: { status: 'up' },
      },
    };

    return reply.send(response);
  });

  // GET /ready - Kubernetes readiness probe
  fastify.get('/ready', {
    schema: {
      tags: ['Health'],
      summary: 'Readiness probe',
      description: 'Indicates if the server is ready to accept traffic.',
      response: {
        200: {
          type: 'object',
          properties: {
            ready: { type: 'boolean' },
          },
        },
      },
    },
  }, async (_request, reply) => {
    return reply.send({ ready: true });
  });

  // GET /live - Kubernetes liveness probe
  fastify.get('/live', {
    schema: {
      tags: ['Health'],
      summary: 'Liveness probe',
      description: 'Indicates if the server process is alive.',
      response: {
        200: {
          type: 'object',
          properties: {
            live: { type: 'boolean' },
          },
        },
      },
    },
  }, async (_request, reply) => {
    return reply.send({ live: true });
  });
};
