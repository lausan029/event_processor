/**
 * Authentication Service
 * Handles verification codes, JWT tokens, and API key management
 */

import crypto from 'crypto';
import { createLogger } from '../../infrastructure/logging/logger.js';
import { getRedisClient, RedisKeys } from '../../infrastructure/database/redis.client.js';
import { getPrismaClient } from '../../infrastructure/database/postgres.client.js';
import { generateJWT, type JWTPayload } from './jwt.service.js';

const logger = createLogger('auth-service');

// Constants
const VERIFICATION_CODE_TTL = 300; // 5 minutes in seconds
const API_KEY_PREFIX = 'evp_'; // Event Processor prefix
const API_KEY_LENGTH = 32;

export interface RequestCodeResult {
  success: boolean;
  message: string;
}

export interface VerifyCodeResult {
  success: boolean;
  token?: string;
  user?: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
  message: string;
}

export interface GenerateApiKeyResult {
  success: boolean;
  apiKey?: string;
  keyId?: string;
  message: string;
}

/**
 * Generates a random 6-digit verification code
 */
function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Generates a secure API key
 */
function generateApiKey(): string {
  const randomBytes = crypto.randomBytes(API_KEY_LENGTH);
  return API_KEY_PREFIX + randomBytes.toString('base64url');
}

/**
 * Hashes an API key for secure storage
 */
function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Mock Mail Service - Logs verification code
 * In production, replace with actual email service
 */
function sendVerificationEmail(email: string, code: string): void {
  logger.info({ 
    email, 
    code,
    ttl: VERIFICATION_CODE_TTL,
  }, `Verification code for ${email}: ${code}`);
}

/**
 * Requests a verification code for the given email
 */
export async function requestVerificationCode(email: string): Promise<RequestCodeResult> {
  const redis = getRedisClient();
  const normalizedEmail = email.toLowerCase().trim();

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalizedEmail)) {
    return {
      success: false,
      message: 'Invalid email format',
    };
  }

  // Check rate limiting (max 3 codes per email in 15 minutes)
  const rateLimitKey = `${RedisKeys.verificationCode(normalizedEmail)}:attempts`;
  const attempts = await redis.incr(rateLimitKey);
  
  if (attempts === 1) {
    await redis.expire(rateLimitKey, 900); // 15 minutes
  }
  
  if (attempts > 3) {
    logger.warn({ email: normalizedEmail, attempts }, 'Rate limit exceeded for verification code');
    return {
      success: false,
      message: 'Too many attempts. Please try again later.',
    };
  }

  // Generate and store code
  const code = generateVerificationCode();
  const key = RedisKeys.verificationCode(normalizedEmail);
  
  await redis.setex(key, VERIFICATION_CODE_TTL, code);

  // Send mock email (logs to console)
  sendVerificationEmail(normalizedEmail, code);

  return {
    success: true,
    message: 'Verification code sent to your email',
  };
}

/**
 * Verifies the code and creates/retrieves user
 */
export async function verifyCode(email: string, code: string): Promise<VerifyCodeResult> {
  const redis = getRedisClient();
  const prisma = getPrismaClient();
  const normalizedEmail = email.toLowerCase().trim();

  // Get stored code
  const key = RedisKeys.verificationCode(normalizedEmail);
  const storedCode = await redis.get(key);

  if (!storedCode) {
    logger.warn({ email: normalizedEmail }, 'Verification code not found or expired');
    return {
      success: false,
      message: 'Verification code expired or not found. Please request a new code.',
    };
  }

  if (storedCode !== code) {
    logger.warn({ email: normalizedEmail }, 'Invalid verification code attempt');
    return {
      success: false,
      message: 'Invalid verification code',
    };
  }

  // Code is valid - delete it
  await redis.del(key);

  // Find or create user
  let user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    // Create new user
    const namePart = normalizedEmail.split('@')[0] ?? 'User';
    const name = namePart.charAt(0).toUpperCase() + namePart.slice(1);
    
    user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name,
        role: 'VIEWER',
        status: 'ACTIVE',
      },
    });

    logger.info({ userId: user.id, email: normalizedEmail }, 'New user created');
  } else {
    // Update status to active if needed
    if (user.status !== 'ACTIVE') {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { status: 'ACTIVE' },
      });
    }
  }

  // Generate JWT
  const payload: JWTPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };

  const token = generateJWT(payload);

  logger.info({ userId: user.id, email: normalizedEmail }, 'User authenticated successfully');

  return {
    success: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    message: 'Authentication successful',
  };
}

/**
 * Generates an API key for the authenticated user
 */
export async function generateUserApiKey(
  userId: string, 
  keyName: string
): Promise<GenerateApiKeyResult> {
  const prisma = getPrismaClient();

  // Verify user exists
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    return {
      success: false,
      message: 'User not found',
    };
  }

  // Check existing API keys (limit to 5 per user)
  const existingKeys = await prisma.apiKey.count({
    where: { 
      userId,
      revokedAt: null,
    },
  });

  if (existingKeys >= 5) {
    return {
      success: false,
      message: 'Maximum number of API keys reached (5). Please revoke an existing key.',
    };
  }

  // Generate new API key
  const apiKey = generateApiKey();
  const keyHash = hashApiKey(apiKey);

  // Store in database
  const apiKeyRecord = await prisma.apiKey.create({
    data: {
      userId,
      keyHash,
      name: keyName || 'Default API Key',
    },
  });

  logger.info({ 
    userId, 
    keyId: apiKeyRecord.id, 
    keyName: apiKeyRecord.name 
  }, 'API key generated');

  return {
    success: true,
    apiKey, // Only returned once - not stored in plain text
    keyId: apiKeyRecord.id,
    message: 'API key generated successfully. Store it securely - it won\'t be shown again.',
  };
}

/**
 * Validates an API key and returns user info
 */
export async function validateApiKey(apiKey: string): Promise<JWTPayload | null> {
  const redis = getRedisClient();
  const prisma = getPrismaClient();

  if (!apiKey.startsWith(API_KEY_PREFIX)) {
    return null;
  }

  const keyHash = hashApiKey(apiKey);
  const cacheKey = RedisKeys.apiKeyCache(keyHash);

  // Check cache first
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as JWTPayload;
  }

  // Query database
  const apiKeyRecord = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: { user: true },
  });

  if (!apiKeyRecord || apiKeyRecord.revokedAt) {
    return null;
  }

  // Check expiration
  if (apiKeyRecord.expiresAt && apiKeyRecord.expiresAt < new Date()) {
    return null;
  }

  // Update last used
  await prisma.apiKey.update({
    where: { id: apiKeyRecord.id },
    data: { lastUsedAt: new Date() },
  });

  const payload: JWTPayload = {
    userId: apiKeyRecord.user.id,
    email: apiKeyRecord.user.email,
    role: apiKeyRecord.user.role,
  };

  // Cache for 5 minutes
  await redis.setex(cacheKey, 300, JSON.stringify(payload));

  return payload;
}
