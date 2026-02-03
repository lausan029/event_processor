/**
 * Authentication Routes
 * POST /auth/request-code - Request verification code
 * POST /auth/verify - Verify code and get JWT
 * POST /auth/api-key - Generate API key (protected)
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { 
  requestVerificationCode, 
  verifyCode, 
  generateUserApiKey 
} from '../../../application/auth/auth.service.js';
import { authenticateRequest } from '../middleware/auth.middleware.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('auth-routes');

// Request validation schemas
const RequestCodeSchema = z.object({
  email: z.string().email('Invalid email format'),
});

const VerifyCodeSchema = z.object({
  email: z.string().email('Invalid email format'),
  code: z.string().length(6, 'Code must be 6 digits').regex(/^\d+$/, 'Code must be numeric'),
});

const GenerateApiKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

export const authRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance
): Promise<void> => {
  
  /**
   * POST /auth/request-code
   * Request a verification code to be sent to the email
   */
  fastify.post('/request-code', async (request, reply) => {
    try {
      const body = RequestCodeSchema.parse(request.body);
      
      logger.info({ email: body.email }, 'Verification code requested');
      
      const result = await requestVerificationCode(body.email);
      
      const statusCode = result.success ? 200 : 400;
      return reply.status(statusCode).send({
        success: result.success,
        data: result.success ? { message: result.message } : undefined,
        error: !result.success ? { code: 'REQUEST_FAILED', message: result.message } : undefined,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const firstError = error.errors[0];
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: firstError?.message ?? 'Invalid request data',
          },
        });
      }
      throw error;
    }
  });

  /**
   * POST /auth/verify
   * Verify the code and get JWT token
   */
  fastify.post('/verify', async (request, reply) => {
    try {
      const body = VerifyCodeSchema.parse(request.body);
      
      logger.info({ email: body.email }, 'Code verification attempted');
      
      const result = await verifyCode(body.email, body.code);
      
      if (result.success) {
        return reply.status(200).send({
          success: true,
          data: {
            token: result.token,
            user: result.user,
            message: result.message,
          },
        });
      } else {
        return reply.status(401).send({
          success: false,
          error: {
            code: 'VERIFICATION_FAILED',
            message: result.message,
          },
        });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        const firstError = error.errors[0];
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: firstError?.message ?? 'Invalid request data',
          },
        });
      }
      throw error;
    }
  });

  /**
   * POST /auth/api-key
   * Generate a new API key (requires authentication)
   */
  fastify.post('/api-key', {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    try {
      const body = GenerateApiKeySchema.parse(request.body ?? {});
      const user = request.user!;
      
      logger.info({ userId: user.userId }, 'API key generation requested');
      
      const result = await generateUserApiKey(user.userId, body.name ?? 'Default API Key');
      
      if (result.success) {
        return reply.status(201).send({
          success: true,
          data: {
            apiKey: result.apiKey,
            keyId: result.keyId,
            message: result.message,
          },
        });
      } else {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'API_KEY_ERROR',
            message: result.message,
          },
        });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        const firstError = error.errors[0];
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: firstError?.message ?? 'Invalid request data',
          },
        });
      }
      throw error;
    }
  });

  /**
   * GET /auth/me
   * Get current user info (requires authentication)
   */
  fastify.get('/me', {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const user = request.user!;
    
    return reply.send({
      success: true,
      data: {
        userId: user.userId,
        email: user.email,
        role: user.role,
      },
    });
  });
};
