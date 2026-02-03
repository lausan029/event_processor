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

export const healthRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance
): Promise<void> => {
  // Simple liveness probe
  fastify.get('/health', async (_request, reply) => {
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

    // TODO: Implement actual health checks for each service
    // This will be enhanced when we add the database connections

    return reply.send(response);
  });

  // Kubernetes readiness probe
  fastify.get('/ready', async (_request, reply) => {
    // TODO: Check if all critical services are connected
    return reply.send({ ready: true });
  });

  // Kubernetes liveness probe
  fastify.get('/live', async (_request, reply) => {
    return reply.send({ live: true });
  });
};
