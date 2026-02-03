/**
 * Application Configuration
 * Loaded from environment variables with sensible defaults for development
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
  readonly host: string;
  readonly port: number;
  readonly password: string | undefined;
}

export interface Config {
  readonly env: string;
  readonly server: ServerConfig;
  readonly mongo: MongoConfig;
  readonly postgres: PostgresConfig;
  readonly redis: RedisConfig;
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

export function loadConfig(): Config {
  return {
    env: getEnvOrDefault('NODE_ENV', 'development'),
    server: {
      host: getEnvOrDefault('SERVER_HOST', '0.0.0.0'),
      port: getEnvAsIntOrDefault('SERVER_PORT', 3001),
    },
    mongo: {
      uri: getEnvOrDefault('MONGO_URI', 'mongodb://mongos:27017'),
      database: getEnvOrDefault('MONGO_DATABASE', 'event_processor'),
    },
    postgres: {
      url: getEnvOrDefault(
        'DATABASE_URL',
        'postgresql://postgres:postgres@postgres:5432/event_processor?schema=public'
      ),
    },
    redis: {
      host: getEnvOrDefault('REDIS_HOST', 'redis'),
      port: getEnvAsIntOrDefault('REDIS_PORT', 6379),
      password: process.env['REDIS_PASSWORD'],
    },
  };
}

/**
 * Validate configuration and return list of errors
 */
export function validateConfig(config: Config): string[] {
  const errors: string[] = [];

  // Validate server config
  if (config.server.port < 1 || config.server.port > 65535) {
    errors.push(`Invalid SERVER_PORT: ${config.server.port}. Must be between 1 and 65535.`);
  }

  // Validate Redis config
  if (!config.redis.host) {
    errors.push('REDIS_HOST is required');
  }
  if (config.redis.port < 1 || config.redis.port > 65535) {
    errors.push(`Invalid REDIS_PORT: ${config.redis.port}. Must be between 1 and 65535.`);
  }

  // Validate MongoDB config
  if (!config.mongo.uri) {
    errors.push('MONGO_URI is required');
  }
  if (!config.mongo.uri.startsWith('mongodb://') && !config.mongo.uri.startsWith('mongodb+srv://')) {
    errors.push(`Invalid MONGO_URI: must start with mongodb:// or mongodb+srv://`);
  }

  // Validate PostgreSQL config
  if (!config.postgres.url) {
    errors.push('DATABASE_URL is required');
  }
  if (!config.postgres.url.startsWith('postgresql://') && !config.postgres.url.startsWith('postgres://')) {
    errors.push(`Invalid DATABASE_URL: must start with postgresql:// or postgres://`);
  }

  return errors;
}
