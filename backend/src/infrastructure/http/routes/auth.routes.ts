/**
 * Authentication Routes
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

// Zod schemas for validation
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

// JSON Schemas for Swagger
const errorResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
      },
    },
  },
} as const;

export const authRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance
): Promise<void> => {
  
  // POST /auth/request-code
  fastify.post('/request-code', {
    schema: {
      tags: ['Auth'],
      summary: 'Request verification code',
      description: 'Sends a 6-digit verification code to the provided email address. In development, the code is logged to the console.',
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email', description: 'User email address' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                message: { type: 'string' },
              },
            },
          },
        },
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
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

  // POST /auth/verify
  fastify.post('/verify', {
    schema: {
      tags: ['Auth'],
      summary: 'Verify code and get JWT',
      description: 'Verifies the 6-digit code and returns a JWT token. Creates the user if not exists.',
      body: {
        type: 'object',
        required: ['email', 'code'],
        properties: {
          email: { type: 'string', format: 'email' },
          code: { type: 'string', pattern: '^\\d{6}$', description: '6-digit verification code' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                token: { type: 'string', description: 'JWT token for authentication' },
                user: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    email: { type: 'string' },
                    role: { type: 'string' },
                  },
                },
                message: { type: 'string' },
              },
            },
          },
        },
        401: errorResponseSchema,
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
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

  // POST /auth/api-key
  fastify.post('/api-key', {
    schema: {
      tags: ['Auth'],
      summary: 'Generate API key',
      description: 'Generates a new API key for event ingestion. Requires JWT authentication.',
      headers: {
        type: 'object',
        properties: {
          authorization: { type: 'string', description: 'Bearer JWT token' },
        },
        required: ['authorization'],
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 100, description: 'API key name' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                apiKey: { type: 'string', description: 'The generated API key (save it, shown only once)' },
                keyId: { type: 'string', description: 'API key identifier' },
                message: { type: 'string' },
              },
            },
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
      },
    },
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

  // GET /auth/me
  fastify.get('/me', {
    schema: {
      tags: ['Auth'],
      summary: 'Get current user',
      description: 'Returns the authenticated user information.',
      headers: {
        type: 'object',
        properties: {
          authorization: { type: 'string', description: 'Bearer JWT token' },
        },
        required: ['authorization'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                userId: { type: 'string' },
                email: { type: 'string' },
                role: { type: 'string' },
              },
            },
          },
        },
        401: errorResponseSchema,
      },
    },
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
