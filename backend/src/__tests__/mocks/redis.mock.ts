/**
 * Redis Client Mock
 * Provides in-memory Redis-like behavior for unit tests
 */

import { vi } from 'vitest';

type RedisValue = string | number | null;

export class MockRedisClient {
  private store: Map<string, RedisValue> = new Map();
  private streams: Map<string, Array<{ id: string; fields: Record<string, string> }>> = new Map();
  private expireTimes: Map<string, number> = new Map();
  private consumerGroups: Map<string, Set<string>> = new Map();

  // Basic operations
  async get(key: string): Promise<string | null> {
    this.checkExpiry(key);
    const val = this.store.get(key);
    return val !== undefined ? String(val) : null;
  }

  async set(key: string, value: string, mode?: string, duration?: number): Promise<'OK'> {
    this.store.set(key, value);
    if (mode === 'EX' && duration) {
      this.expireTimes.set(key, Date.now() + duration * 1000);
    }
    return 'OK';
  }

  async setex(key: string, seconds: number, value: string): Promise<'OK'> {
    this.store.set(key, value);
    this.expireTimes.set(key, Date.now() + seconds * 1000);
    return 'OK';
  }

  async setnx(key: string, value: string): Promise<number> {
    if (this.store.has(key)) {
      return 0;
    }
    this.store.set(key, value);
    return 1;
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.store.delete(key)) count++;
    }
    return count;
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (!this.store.has(key)) return 0;
    this.expireTimes.set(key, Date.now() + seconds * 1000);
    return 1;
  }

  async mget(...keys: string[]): Promise<(string | null)[]> {
    return keys.map(key => {
      this.checkExpiry(key);
      const val = this.store.get(key);
      return val !== undefined ? String(val) : null;
    });
  }

  async incrby(key: string, increment: number): Promise<number> {
    const current = parseInt(String(this.store.get(key) ?? '0'), 10);
    const newValue = current + increment;
    this.store.set(key, String(newValue));
    return newValue;
  }

  async incr(key: string): Promise<number> {
    return this.incrby(key, 1);
  }

  async hset(key: string, ...args: string[]): Promise<number> {
    let existing = this.store.get(key);
    if (typeof existing !== 'object') {
      existing = '{}';
      this.store.set(key, existing);
    }
    return args.length / 2;
  }

  async hget(_key: string, _field: string): Promise<string | null> {
    return null;
  }

  async hgetall(_key: string): Promise<Record<string, string>> {
    return {};
  }

  // Stream operations
  async xadd(stream: string, id: string, ...fieldsAndValues: string[]): Promise<string> {
    if (!this.streams.has(stream)) {
      this.streams.set(stream, []);
    }
    const fields: Record<string, string> = {};
    for (let i = 0; i < fieldsAndValues.length; i += 2) {
      const fieldKey = fieldsAndValues[i];
      const fieldValue = fieldsAndValues[i + 1];
      if (fieldKey !== undefined && fieldValue !== undefined) {
        fields[fieldKey] = fieldValue;
      }
    }
    const messageId = id === '*' ? `${Date.now()}-0` : id;
    this.streams.get(stream)!.push({ id: messageId, fields });
    return messageId;
  }

  async xreadgroup(
    _group: string,
    _groupName: string,
    _consumer: string,
    _consumerName: string,
    _count: string,
    count: number,
    _block: string,
    _blockMs: number,
    _streams: string,
    streamName: string,
    _startId: string
  ): Promise<Array<[string, Array<[string, string[]]>]> | null> {
    const stream = this.streams.get(streamName);
    if (!stream || stream.length === 0) return null;
    
    const messages = stream.splice(0, count);
    if (messages.length === 0) return null;
    
    const result: Array<[string, string[]]> = messages.map(msg => {
      const flatFields: string[] = [];
      for (const [k, v] of Object.entries(msg.fields)) {
        flatFields.push(k, v);
      }
      return [msg.id, flatFields] as [string, string[]];
    });
    
    return [[streamName, result]];
  }

  async xack(_stream: string, _group: string, ...ids: string[]): Promise<number> {
    return ids.length;
  }

  async xgroup(
    command: string,
    stream: string,
    groupName: string,
    _startId?: string,
    _mkstream?: string
  ): Promise<'OK' | number> {
    if (command === 'CREATE') {
      if (!this.consumerGroups.has(stream)) {
        this.consumerGroups.set(stream, new Set());
      }
      this.consumerGroups.get(stream)!.add(groupName);
      return 'OK';
    }
    return 0;
  }

  async xlen(stream: string): Promise<number> {
    return this.streams.get(stream)?.length ?? 0;
  }

  // Pipeline
  pipeline() {
    const commands: Array<{ method: string; args: unknown[] }> = [];
    const self = this;
    
    const pipe = {
      setnx(key: string, value: string) {
        commands.push({ method: 'setnx', args: [key, value] });
        return pipe;
      },
      expire(key: string, seconds: number) {
        commands.push({ method: 'expire', args: [key, seconds] });
        return pipe;
      },
      incrby(key: string, increment: number) {
        commands.push({ method: 'incrby', args: [key, increment] });
        return pipe;
      },
      xadd(...args: unknown[]) {
        commands.push({ method: 'xadd', args });
        return pipe;
      },
      async exec(): Promise<Array<[Error | null, unknown]>> {
        const results: Array<[Error | null, unknown]> = [];
        for (const cmd of commands) {
          try {
            const methodName = cmd.method;
            const fn = (self as unknown as Record<string, ((...args: unknown[]) => Promise<unknown>) | undefined>)[methodName];
            if (fn) {
              const execResult = await fn.apply(self, cmd.args);
              results.push([null, execResult]);
            } else {
              results.push([new Error(`Method ${methodName} not found`), null]);
            }
          } catch (error) {
            results.push([error as Error, null]);
          }
        }
        return results;
      },
    };
    return pipe;
  }

  // Connection
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async ping(): Promise<string> { return 'PONG'; }
  async quit(): Promise<void> {}

  // Utility
  private checkExpiry(key: string): void {
    const expiry = this.expireTimes.get(key);
    if (expiry && Date.now() > expiry) {
      this.store.delete(key);
      this.expireTimes.delete(key);
    }
  }

  // Test helpers
  clear(): void {
    this.store.clear();
    this.streams.clear();
    this.expireTimes.clear();
    this.consumerGroups.clear();
  }

  getStreamMessages(stream: string) {
    return this.streams.get(stream) ?? [];
  }
}

export const mockRedisClient = new MockRedisClient();

export const createMockRedisModule = () => ({
  getRedisClient: vi.fn(() => mockRedisClient),
  createRedisClient: vi.fn(() => mockRedisClient),
  closeRedisClient: vi.fn(),
});
