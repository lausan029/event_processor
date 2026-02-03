/**
 * User types for master data (stored in PostgreSQL).
 * Auth tokens cached in Redis to prevent Postgres saturation.
 */

export type UserId = string;

/** User status in the system */
export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
}

/** User role for authorization */
export enum UserRole {
  ADMIN = 'ADMIN',
  OPERATOR = 'OPERATOR',
  VIEWER = 'VIEWER',
  API_CLIENT = 'API_CLIENT',
}

/** Core user entity (PostgreSQL) */
export interface User {
  readonly id: UserId;
  readonly email: string;
  readonly name: string;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly apiKeyHash?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** User creation payload */
export interface CreateUserPayload {
  readonly email: string;
  readonly name: string;
  readonly role?: UserRole;
}

/** User update payload */
export interface UpdateUserPayload {
  readonly email?: string;
  readonly name?: string;
  readonly role?: UserRole;
  readonly status?: UserStatus;
}

/** API Key info cached in Redis */
export interface CachedApiKey {
  readonly userId: UserId;
  readonly role: UserRole;
  readonly expiresAt: Date;
}
