/**
 * Unit Tests: API Key Middleware
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockRedisClient, createMockRedisModule } from '../mocks/redis.mock.js';

// Mock dependencies
vi.mock('../../infrastructure/database/redis.client.js', () => createMockRedisModule());

// Mock Prisma
const mockPrismaClient = {
  apiKey: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
};
vi.mock('../../infrastructure/database/postgres.client.js', () => ({
  getPrismaClient: () => mockPrismaClient,
  createPrismaClient: () => mockPrismaClient,
}));

// Import after mocking
const { authenticateApiKey, optionalApiKeyAuth } = await import('../../infrastructure/http/middleware/apikey.middleware.js');

// Mock request and reply
function createMockRequest(headers: Record<string, string | undefined> = {}) {
  return {
    headers,
    apiKeyPayload: undefined,
  } as unknown as Parameters<typeof authenticateApiKey>[0];
}

function createMockReply() {
  const reply = {
    statusCode: 200,
    body: null as unknown,
    status: vi.fn().mockImplementation(function(this: typeof reply, code: number) {
      this.statusCode = code;
      return this;
    }),
    send: vi.fn().mockImplementation(function(this: typeof reply, body: unknown) {
      this.body = body;
      return this;
    }),
  };
  return reply as unknown as Parameters<typeof authenticateApiKey>[1];
}

describe('API Key Middleware', () => {
  beforeEach(() => {
    mockRedisClient.clear();
    vi.clearAllMocks();
  });

  describe('authenticateApiKey', () => {
    it('should return 401 when x-api-key header is missing', async () => {
      const request = createMockRequest({});
      const reply = createMockReply();

      await authenticateApiKey(request, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'MISSING_API_KEY',
        }),
      }));
    });

    it('should return 401 when API key format is invalid', async () => {
      const request = createMockRequest({ 'x-api-key': 'invalid_key_format' });
      const reply = createMockReply();

      await authenticateApiKey(request, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({
          code: 'INVALID_API_KEY',
          message: 'Invalid API key format',
        }),
      }));
    });

    it('should return 401 when API key not found in cache or database', async () => {
      mockPrismaClient.apiKey.findUnique.mockResolvedValue(null);
      
      const request = createMockRequest({ 'x-api-key': 'evp_invalid_key_12345' });
      const reply = createMockReply();

      await authenticateApiKey(request, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({
          code: 'INVALID_API_KEY',
        }),
      }));
    });

    it('should return 401 when API key is revoked', async () => {
      mockPrismaClient.apiKey.findUnique.mockResolvedValue({
        id: 'key_123',
        keyHash: 'hash123',
        revokedAt: new Date(),
        user: { id: 'user_1', email: 'test@example.com', role: 'USER', status: 'ACTIVE' },
      });
      
      const request = createMockRequest({ 'x-api-key': 'evp_revoked_key_12345' });
      const reply = createMockReply();

      await authenticateApiKey(request, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
    });

    it('should return 401 when API key is expired', async () => {
      mockPrismaClient.apiKey.findUnique.mockResolvedValue({
        id: 'key_123',
        keyHash: 'hash123',
        revokedAt: null,
        expiresAt: new Date(Date.now() - 86400000), // Expired yesterday
        user: { id: 'user_1', email: 'test@example.com', role: 'USER', status: 'ACTIVE' },
      });
      
      const request = createMockRequest({ 'x-api-key': 'evp_expired_key_12345' });
      const reply = createMockReply();

      await authenticateApiKey(request, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
    });

    it('should return 401 when user is inactive', async () => {
      mockPrismaClient.apiKey.findUnique.mockResolvedValue({
        id: 'key_123',
        keyHash: 'hash123',
        revokedAt: null,
        expiresAt: null,
        user: { id: 'user_1', email: 'test@example.com', role: 'USER', status: 'SUSPENDED' },
      });
      
      const request = createMockRequest({ 'x-api-key': 'evp_inactive_user_key' });
      const reply = createMockReply();

      await authenticateApiKey(request, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
    });

    it('should attach payload to request when API key is valid', async () => {
      mockPrismaClient.apiKey.findUnique.mockResolvedValue({
        id: 'key_123',
        keyHash: 'hash123',
        revokedAt: null,
        expiresAt: null,
        userId: 'user_1',
        user: { id: 'user_1', email: 'test@example.com', role: 'USER', status: 'ACTIVE' },
      });
      mockPrismaClient.apiKey.update.mockResolvedValue({});
      
      const request = createMockRequest({ 'x-api-key': 'evp_valid_key_12345' });
      const reply = createMockReply();

      await authenticateApiKey(request, reply);

      expect(reply.status).not.toHaveBeenCalled();
      expect(request.apiKeyPayload).toBeDefined();
      expect(request.apiKeyPayload?.userId).toBe('user_1');
      expect(request.apiKeyPayload?.email).toBe('test@example.com');
    });

    it('should use cached API key on second request', async () => {
      // First request - cache miss
      mockPrismaClient.apiKey.findUnique.mockResolvedValue({
        id: 'key_123',
        keyHash: 'hash123',
        revokedAt: null,
        expiresAt: null,
        userId: 'user_1',
        user: { id: 'user_1', email: 'cached@example.com', role: 'ADMIN', status: 'ACTIVE' },
      });
      mockPrismaClient.apiKey.update.mockResolvedValue({});
      
      const apiKey = 'evp_cached_key_12345';
      
      const request1 = createMockRequest({ 'x-api-key': apiKey });
      const reply1 = createMockReply();
      await authenticateApiKey(request1, reply1);
      
      expect(mockPrismaClient.apiKey.findUnique).toHaveBeenCalledTimes(1);
      
      // Second request - should use cache
      const request2 = createMockRequest({ 'x-api-key': apiKey });
      const reply2 = createMockReply();
      await authenticateApiKey(request2, reply2);
      
      // Prisma should not be called again
      expect(mockPrismaClient.apiKey.findUnique).toHaveBeenCalledTimes(1);
      expect(request2.apiKeyPayload?.email).toBe('cached@example.com');
    });
  });

  describe('optionalApiKeyAuth', () => {
    it('should not fail when API key is missing', async () => {
      const request = createMockRequest({});
      const reply = createMockReply();

      await optionalApiKeyAuth(request, reply);

      expect(reply.status).not.toHaveBeenCalled();
      expect(request.apiKeyPayload).toBeUndefined();
    });

    it('should not fail when API key is invalid format', async () => {
      const request = createMockRequest({ 'x-api-key': 'invalid' });
      const reply = createMockReply();

      await optionalApiKeyAuth(request, reply);

      expect(reply.status).not.toHaveBeenCalled();
      expect(request.apiKeyPayload).toBeUndefined();
    });

    it('should attach payload when API key is valid', async () => {
      mockPrismaClient.apiKey.findUnique.mockResolvedValue({
        id: 'key_optional',
        keyHash: 'hash',
        revokedAt: null,
        expiresAt: null,
        userId: 'user_opt',
        user: { id: 'user_opt', email: 'optional@example.com', role: 'USER', status: 'ACTIVE' },
      });
      mockPrismaClient.apiKey.update.mockResolvedValue({});
      
      const request = createMockRequest({ 'x-api-key': 'evp_optional_key_123' });
      const reply = createMockReply();

      await optionalApiKeyAuth(request, reply);

      expect(request.apiKeyPayload).toBeDefined();
      expect(request.apiKeyPayload?.email).toBe('optional@example.com');
    });
  });
});
