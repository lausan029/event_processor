/**
 * JWT Service
 * Handles token generation and verification
 */

import crypto from 'crypto';
import { createLogger } from '../../infrastructure/logging/logger.js';

const logger = createLogger('jwt-service');

// In production, use a proper secret from environment variables
const JWT_SECRET = process.env['JWT_SECRET'] ?? 'dev-secret-change-in-production-123!';
const JWT_EXPIRATION = 24 * 60 * 60; // 24 hours in seconds

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
}

interface JWTHeader {
  alg: string;
  typ: string;
}

interface JWTFullPayload extends JWTPayload {
  iat: number;
  exp: number;
}

/**
 * Base64Url encode
 */
function base64UrlEncode(data: string): string {
  return Buffer.from(data)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Base64Url decode
 */
function base64UrlDecode(data: string): string {
  const padded = data + '='.repeat((4 - (data.length % 4)) % 4);
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/**
 * Create HMAC-SHA256 signature
 */
function createSignature(data: string): string {
  return crypto
    .createHmac('sha256', JWT_SECRET)
    .update(data)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Generate a JWT token
 */
export function generateJWT(payload: JWTPayload): string {
  const header: JWTHeader = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JWTFullPayload = {
    ...payload,
    iat: now,
    exp: now + JWT_EXPIRATION,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = createSignature(`${encodedHeader}.${encodedPayload}`);

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Verify and decode a JWT token
 */
export function verifyJWT(token: string): JWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      logger.debug('Invalid JWT format');
      return null;
    }

    const [encodedHeader, encodedPayload, signature] = parts;
    
    if (!encodedHeader || !encodedPayload || !signature) {
      return null;
    }

    // Verify signature
    const expectedSignature = createSignature(`${encodedHeader}.${encodedPayload}`);
    if (signature !== expectedSignature) {
      logger.debug('Invalid JWT signature');
      return null;
    }

    // Decode and parse payload
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as JWTFullPayload;

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      logger.debug({ exp: payload.exp, now }, 'JWT expired');
      return null;
    }

    return {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
    };
  } catch (error) {
    logger.debug({ error }, 'JWT verification failed');
    return null;
  }
}

/**
 * Extract token from Authorization header
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}
