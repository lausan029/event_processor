/**
 * Authentication Middleware
 * Supports both JWT tokens and API keys
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyJWT, extractBearerToken, type JWTPayload } from '../../../application/auth/jwt.service.js';
import { validateApiKey } from '../../../application/auth/auth.service.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('auth-middleware');

// Extend FastifyRequest to include user info
declare module 'fastify' {
  interface FastifyRequest {
    user?: JWTPayload;
  }
}

/**
 * Authenticate request using JWT or API Key
 */
export async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  const apiKey = request.headers['x-api-key'] as string | undefined;

  let payload: JWTPayload | null = null;

  // Try JWT first
  if (authHeader) {
    const token = extractBearerToken(authHeader);
    if (token) {
      payload = verifyJWT(token);
    }
  }

  // Fall back to API key
  if (!payload && apiKey) {
    payload = await validateApiKey(apiKey);
  }

  if (!payload) {
    logger.debug({ 
      hasAuthHeader: !!authHeader, 
      hasApiKey: !!apiKey 
    }, 'Authentication failed');
    
    return reply.status(401).send({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or missing authentication credentials',
      },
    });
  }

  // Attach user to request
  request.user = payload;
}

/**
 * Optional authentication - doesn't fail if not authenticated
 */
export async function optionalAuthentication(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  const apiKey = request.headers['x-api-key'] as string | undefined;

  let payload: JWTPayload | null = null;

  if (authHeader) {
    const token = extractBearerToken(authHeader);
    if (token) {
      payload = verifyJWT(token);
    }
  }

  if (!payload && apiKey) {
    payload = await validateApiKey(apiKey);
  }

  if (payload) {
    request.user = payload;
  }
}

/**
 * Require specific role
 */
export function requireRole(allowedRoles: string[]) {
  return async function (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
    }

    if (!allowedRoles.includes(request.user.role)) {
      logger.warn({ 
        userId: request.user.userId, 
        role: request.user.role, 
        requiredRoles: allowedRoles 
      }, 'Insufficient permissions');
      
      return reply.status(403).send({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions',
        },
      });
    }
  };
}
