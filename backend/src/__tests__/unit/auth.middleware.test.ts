/**
 * Unit Tests: Auth Middleware
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock JWT service
const mockVerifyJWT = vi.fn();
const mockExtractBearerToken = vi.fn();

vi.mock('../../application/auth/jwt.service.js', () => ({
  verifyJWT: () => mockVerifyJWT(),
  extractBearerToken: (header: string) => mockExtractBearerToken(header),
}));

// Mock validate API key
const mockValidateApiKey = vi.fn();

vi.mock('../../application/auth/auth.service.js', () => ({
  validateApiKey: (key: string) => mockValidateApiKey(key),
}));

// Import after mocking
const { authenticateRequest, optionalAuthentication, requireRole } = await import('../../infrastructure/http/middleware/auth.middleware.js');

function createMockRequest(headers: Record<string, string | undefined> = {}) {
  return {
    headers,
    user: undefined,
  } as unknown as Parameters<typeof authenticateRequest>[0];
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
  return reply as unknown as Parameters<typeof authenticateRequest>[1];
}

describe('Auth Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyJWT.mockReset();
    mockExtractBearerToken.mockReset();
    mockValidateApiKey.mockReset();
  });

  describe('authenticateRequest', () => {
    it('should return 401 when no auth credentials provided', async () => {
      mockExtractBearerToken.mockReturnValue(null);
      mockValidateApiKey.mockResolvedValue(null);
      
      const request = createMockRequest({});
      const reply = createMockReply();

      await authenticateRequest(request, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({
          code: 'UNAUTHORIZED',
        }),
      }));
    });

    it('should authenticate with valid JWT token', async () => {
      const mockPayload = { userId: 'user_1', email: 'test@example.com', role: 'USER' };
      mockExtractBearerToken.mockReturnValue('valid-jwt-token');
      mockVerifyJWT.mockReturnValue(mockPayload);
      
      const request = createMockRequest({ authorization: 'Bearer valid-jwt-token' });
      const reply = createMockReply();

      await authenticateRequest(request, reply);

      expect(reply.status).not.toHaveBeenCalled();
      expect(request.user).toEqual(mockPayload);
    });

    it('should fall back to API key when JWT is invalid', async () => {
      mockExtractBearerToken.mockReturnValue('invalid-jwt');
      mockVerifyJWT.mockReturnValue(null);
      
      const mockPayload = { userId: 'user_2', email: 'api@example.com', role: 'USER' };
      mockValidateApiKey.mockResolvedValue(mockPayload);
      
      const request = createMockRequest({ 
        authorization: 'Bearer invalid-jwt',
        'x-api-key': 'evp_valid_key',
      });
      const reply = createMockReply();

      await authenticateRequest(request, reply);

      expect(reply.status).not.toHaveBeenCalled();
      expect(request.user).toEqual(mockPayload);
    });

    it('should authenticate with API key only', async () => {
      mockExtractBearerToken.mockReturnValue(null);
      
      const mockPayload = { userId: 'user_3', email: 'key@example.com', role: 'ADMIN' };
      mockValidateApiKey.mockResolvedValue(mockPayload);
      
      const request = createMockRequest({ 'x-api-key': 'evp_api_key_123' });
      const reply = createMockReply();

      await authenticateRequest(request, reply);

      expect(request.user).toEqual(mockPayload);
    });

    it('should return 401 when both JWT and API key are invalid', async () => {
      mockExtractBearerToken.mockReturnValue('bad-jwt');
      mockVerifyJWT.mockReturnValue(null);
      mockValidateApiKey.mockResolvedValue(null);
      
      const request = createMockRequest({ 
        authorization: 'Bearer bad-jwt',
        'x-api-key': 'evp_bad_key',
      });
      const reply = createMockReply();

      await authenticateRequest(request, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
    });
  });

  describe('optionalAuthentication', () => {
    it('should not fail when no credentials provided', async () => {
      mockExtractBearerToken.mockReturnValue(null);
      
      const request = createMockRequest({});
      const reply = createMockReply();

      await optionalAuthentication(request, reply);

      expect(reply.status).not.toHaveBeenCalled();
      expect(request.user).toBeUndefined();
    });

    it('should not attach user when credentials are invalid', async () => {
      mockExtractBearerToken.mockReturnValue('invalid');
      mockVerifyJWT.mockReturnValue(null);
      mockValidateApiKey.mockResolvedValue(null);
      
      const request = createMockRequest({ authorization: 'Bearer invalid' });
      const reply = createMockReply();

      await optionalAuthentication(request, reply);

      expect(reply.status).not.toHaveBeenCalled();
      expect(request.user).toBeUndefined();
    });
  });

  describe('requireRole', () => {
    it('should return 401 when user is not authenticated', async () => {
      const middleware = requireRole(['ADMIN']);
      
      const request = createMockRequest({});
      request.user = undefined;
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
    });

    it('should return 403 when user role is not allowed', async () => {
      const middleware = requireRole(['ADMIN']);
      
      const request = createMockRequest({});
      (request as unknown as { user: { userId: string; role: string } }).user = { userId: 'user_5', role: 'USER' };
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.status).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({
          code: 'FORBIDDEN',
        }),
      }));
    });

    it('should allow when user has required role', async () => {
      const middleware = requireRole(['ADMIN', 'MODERATOR']);
      
      const request = createMockRequest({});
      (request as unknown as { user: { userId: string; role: string } }).user = { userId: 'user_6', role: 'ADMIN' };
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.status).not.toHaveBeenCalled();
    });

    it('should allow multiple roles', async () => {
      const middleware = requireRole(['USER', 'ADMIN']);
      
      const request = createMockRequest({});
      (request as unknown as { user: { userId: string; role: string } }).user = { userId: 'user_7', role: 'USER' };
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.status).not.toHaveBeenCalled();
    });
  });
});
