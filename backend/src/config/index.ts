/**
 * Application Configuration
 * Loaded from environment variables with sensible defaults for development
 * All sensitive values MUST be provided via environment variables in production
 */

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
}

export interface MongoConfig {
  readonly uri: string;
  readonly database: string;
}

export interface PostgresConfig {
  readonly url: string;
}

export interface RedisConfig {
  readonly url: string | undefined;
  readonly host: string;
  readonly port: number;
  readonly password: string | undefined;
}

export interface AuthConfig {
  readonly jwtSecret: string;
  readonly jwtExpiresIn: string;
  readonly apiKeyPrefix: string;
}

export interface WorkerConfig {
  readonly consumerId: string;
  readonly consumerGroup: string;
  readonly batchSize: number;
  readonly batchTimeoutMs: number;
}

export interface Config {
  readonly env: string;
  readonly server: ServerConfig;
  readonly mongo: MongoConfig;
  readonly postgres: PostgresConfig;
  readonly redis: RedisConfig;
  readonly auth: AuthConfig;
  readonly worker: WorkerConfig;
}

function getEnvOrDefault(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function getEnvAsIntOrDefault(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value && process.env['NODE_ENV'] === 'production') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value ?? '';
}

export function loadConfig(): Config {
  const env = getEnvOrDefault('NODE_ENV', 'development');
  const isProduction = env === 'production';
  
  // Generate dynamic consumer ID for workers
  const hostname = process.env['HOSTNAME'] ?? process.env['RAILWAY_REPLICA_ID'] ?? `local-${Date.now()}`;
  
  return {
    env,
    server: {
      host: getEnvOrDefault('SERVER_HOST', '0.0.0.0'),
      port: getEnvAsIntOrDefault('PORT', getEnvAsIntOrDefault('SERVER_PORT', 3001)),
    },
    mongo: {
      uri: isProduction 
        ? getRequiredEnv('MONGO_URI') 
        : getEnvOrDefault('MONGO_URI', 'mongodb://mongos:27017'),
      database: getEnvOrDefault('MONGO_DATABASE', 'event_processor'),
    },
    postgres: {
      // DATABASE_URL is only required for backend API, not for workers
      // Workers only need MongoDB and Redis
      url: getEnvOrDefault(
        'DATABASE_URL',
        'postgresql://postgres:postgres@postgres:5432/event_processor?schema=public'
      ),
    },
    redis: {
      url: process.env['REDIS_URL'],
      host: getEnvOrDefault('REDIS_HOST', 'redis'),
      port: getEnvAsIntOrDefault('REDIS_PORT', 6379),
      password: process.env['REDIS_PASSWORD'],
    },
    auth: {
      // JWT_SECRET is only required for backend API (for user authentication)
      // Workers don't need JWT, so use a default value if not provided
      jwtSecret: getEnvOrDefault('JWT_SECRET', 'dev-secret-change-in-production-worker-does-not-need-jwt'),
      jwtExpiresIn: getEnvOrDefault('JWT_EXPIRES_IN', '24h'),
      apiKeyPrefix: getEnvOrDefault('API_KEY_PREFIX', 'evp_'),
    },
    worker: {
      consumerId: getEnvOrDefault('CONSUMER_NAME', `worker-${hostname}`),
      consumerGroup: getEnvOrDefault('CONSUMER_GROUP', 'evp-workers-group'),
      batchSize: getEnvAsIntOrDefault('WORKER_BATCH_SIZE', 100),
      batchTimeoutMs: getEnvAsIntOrDefault('WORKER_BATCH_TIMEOUT_MS', 500),
    },
  };
}

/**
 * Validate configuration and return list of errors
 */
export function validateConfig(config: Config): string[] {
  const errors: string[] = [];
  const isProduction = config.env === 'production';

  // Validate server config
  if (config.server.port < 1 || config.server.port > 65535) {
    errors.push(`Invalid PORT: ${config.server.port}. Must be between 1 and 65535.`);
  }

  // Validate Redis config
  if (!config.redis.url && !config.redis.host) {
    errors.push('REDIS_URL or REDIS_HOST is required');
  }
  if (config.redis.port < 1 || config.redis.port > 65535) {
    errors.push(`Invalid REDIS_PORT: ${config.redis.port}. Must be between 1 and 65535.`);
  }

  // Validate MongoDB config
  if (!config.mongo.uri) {
    errors.push('MONGO_URI is required');
  }
  if (config.mongo.uri && !config.mongo.uri.startsWith('mongodb://') && !config.mongo.uri.startsWith('mongodb+srv://')) {
    errors.push(`Invalid MONGO_URI: must start with mongodb:// or mongodb+srv://`);
  }

  // Validate PostgreSQL config
  if (!config.postgres.url) {
    errors.push('DATABASE_URL is required');
  }
  if (config.postgres.url && !config.postgres.url.startsWith('postgresql://') && !config.postgres.url.startsWith('postgres://')) {
    errors.push(`Invalid DATABASE_URL: must start with postgresql:// or postgres://`);
  }

  // Validate auth config in production
  if (isProduction) {
    if (!config.auth.jwtSecret || config.auth.jwtSecret.length < 32) {
      errors.push('JWT_SECRET must be at least 32 characters in production');
    }
    if (config.auth.jwtSecret === 'dev-secret-change-in-production') {
      errors.push('JWT_SECRET must be changed from default in production');
    }
  }

  // Validate worker config
  if (config.worker.batchSize < 1 || config.worker.batchSize > 10000) {
    errors.push(`Invalid WORKER_BATCH_SIZE: ${config.worker.batchSize}. Must be between 1 and 10000.`);
  }

  return errors;
}

/**
 * Get Redis URL (prefer REDIS_URL, fallback to host:port)
 */
export function getRedisUrl(config: Config): string {
  if (config.redis.url) {
    return config.redis.url;
  }
  const auth = config.redis.password ? `:${config.redis.password}@` : '';
  return `redis://${auth}${config.redis.host}:${config.redis.port}`;
}
