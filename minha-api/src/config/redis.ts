import Redis, { RedisOptions } from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

// In-memory fallback cache
class MemoryCache {
  private cache: Map<string, { value: string; expiry: number }> = new Map();

  async get(key: string): Promise<string | null> {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const expiry = ttlSeconds ? Date.now() + ttlSeconds * 1000 : Number.MAX_SAFE_INTEGER;
    this.cache.set(key, { value, expiry });
  }

  async del(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp('^' + pattern.replace('*', '.*') + '$');
    return Array.from(this.cache.keys()).filter(k => regex.test(k));
  }

  async mget(...keys: string[]): Promise<(string | null)[]> {
    return keys.map(k => this.cache.get(k)?.value ?? null);
  }

  async setex(key: string, seconds: number, value: string): Promise<void> {
    await this.set(key, value, seconds);
  }

  async setnx(key: string, value: string, ttlSeconds?: number): Promise<number> {
    const existing = await this.get(key);
    if (existing !== null) {
      return 0;
    }
    await this.set(key, value, ttlSeconds);
    return 1;
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    const current = await this.get(key);
    const next = current ? Number(current) + 1 : 1;
    await this.set(key, String(next), ttlSeconds);
    return next;
  }

  async exists(key: string): Promise<number> {
    return this.cache.has(key) ? 1 : 0;
  }

  async ttl(key: string): Promise<number> {
    const item = this.cache.get(key);
    if (!item) return -2;
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return -2;
    }
    return Math.floor((item.expiry - Date.now()) / 1000);
  }
}

const DEFAULT_REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const DEFAULT_REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

const redisRetryStrategy = (times: number) => {
  // Stop retrying after 3 attempts - use fallback
  if (times >= 3) return null;
  const delay = Math.min(times * 50, 2000);
  return delay;
};

// Try to create Redis connection, fallback to memory cache
export const redisConfig: RedisOptions = {
  host: DEFAULT_REDIS_HOST,
  port: DEFAULT_REDIS_PORT,
  password: process.env.REDIS_PASSWORD || undefined,
  retryStrategy: redisRetryStrategy,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  enableOfflineQueue: false,
};

const redisUrl = process.env.REDIS_URL;

export function getRedisUrl(): string {
  if (redisUrl) {
    return redisUrl;
  }

  const auth = redisConfig.password
    ? `:${encodeURIComponent(redisConfig.password)}@`
    : '';

  return `redis://${auth}${DEFAULT_REDIS_HOST}:${DEFAULT_REDIS_PORT}`;
}

// Create Redis instance (prioritize REDIS_URL when provided)
const redisClient = redisUrl
  ? new Redis(redisUrl, {
    retryStrategy: redisRetryStrategy,
    maxRetriesPerRequest: redisConfig.maxRetriesPerRequest,
    lazyConnect: redisConfig.lazyConnect,
    enableOfflineQueue: redisConfig.enableOfflineQueue,
  })
  : new Redis(redisConfig);

// Create memory fallback
const memoryCache = new MemoryCache();

// Track if Redis is connected
let redisAvailable = false;

redisClient.on('connect', () => {
  redisAvailable = true;
  console.log('✅ Redis connection established successfully.');
});

redisClient.on('error', (_error) => {
  if (!redisAvailable) {
    console.warn('⚠️ Redis unavailable, using in-memory fallback cache.');
  }
  redisAvailable = false;
});

redisClient.on('close', () => {
  redisAvailable = false;
});

// Try to connect, but don't block if it fails
redisClient.connect().catch(() => {
  console.warn('⚠️ Redis connection failed, using in-memory fallback.');
});

// Unified cache interface - uses Redis if available, memory fallback otherwise
export const cache = {
  async get(key: string): Promise<string | null> {
    if (redisAvailable) {
      try {
        return await redisClient.get(key);
      } catch {
        return memoryCache.get(key);
      }
    }
    return memoryCache.get(key);
  },

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (redisAvailable) {
      try {
        if (ttlSeconds) {
          await redisClient.setex(key, ttlSeconds, value);
        } else {
          await redisClient.set(key, value);
        }
        return;
      } catch {
        // Fall through to memory cache
      }
    }
    return memoryCache.set(key, value, ttlSeconds);
  },

  async del(key: string): Promise<void> {
    if (redisAvailable) {
      try {
        await redisClient.del(key);
        return;
      } catch {
        // Fall through to memory cache
      }
    }
    return memoryCache.del(key);
  },

  async keys(pattern: string): Promise<string[]> {
    if (redisAvailable) {
      try {
        return await redisClient.keys(pattern);
      } catch {
        return memoryCache.keys(pattern);
      }
    }
    return memoryCache.keys(pattern);
  },

  async mget(...keys: string[]): Promise<(string | null)[]> {
    if (redisAvailable) {
      try {
        return await redisClient.mget(...keys);
      } catch {
        return memoryCache.mget(...keys);
      }
    }
    return memoryCache.mget(...keys);
  },

  async setex(key: string, seconds: number, value: string): Promise<void> {
    return this.set(key, value, seconds);
  },

  async setnx(key: string, value: string, ttlSeconds?: number): Promise<number> {
    if (redisAvailable) {
      try {
        if (ttlSeconds) {
          const result = await redisClient.set(key, value, 'EX', ttlSeconds, 'NX');
          return result === 'OK' ? 1 : 0;
        }
        const result = await redisClient.setnx(key, value);
        return result;
      } catch {
        return memoryCache.setnx(key, value, ttlSeconds);
      }
    }
    return memoryCache.setnx(key, value, ttlSeconds);
  },

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    if (redisAvailable) {
      try {
        const value = await redisClient.incr(key);
        if (value === 1 && ttlSeconds) {
          await redisClient.expire(key, ttlSeconds);
        }
        return value;
      } catch {
        return memoryCache.incr(key, ttlSeconds);
      }
    }
    return memoryCache.incr(key, ttlSeconds);
  },

  async exists(key: string): Promise<number> {
    if (redisAvailable) {
      try {
        return await redisClient.exists(key);
      } catch {
        return memoryCache.exists(key);
      }
    }
    return memoryCache.exists(key);
  },

  async ttl(key: string): Promise<number> {
    if (redisAvailable) {
      try {
        return await redisClient.ttl(key);
      } catch {
        return memoryCache.ttl(key);
      }
    }
    return memoryCache.ttl(key);
  },

  isAvailable(): boolean {
    return redisAvailable;
  },
};

// For backward compatibility - direct redis access
export const redis = {
  get: (key: string) => cache.get(key),
  set: (key: string, value: string, ttl?: number) => cache.set(key, value, ttl),
  del: (key: string) => cache.del(key),
  keys: (pattern: string) => cache.keys(pattern),
  mget: (...keys: string[]) => cache.mget(...keys),
  setex: (key: string, seconds: number, value: string) => cache.setex(key, seconds, value),
  setnx: (key: string, value: string, ttlSeconds?: number) => cache.setnx(key, value, ttlSeconds),
  incr: (key: string, ttlSeconds?: number) => cache.incr(key, ttlSeconds),
  exists: (key: string) => cache.exists(key),
  ttl: (key: string) => cache.ttl(key),
  isAvailable: () => redisAvailable,
  quit: async () => {
    if (redisAvailable) {
      try {
        await redisClient.quit();
      } catch {
        // Ignore errors during quit
      }
    }
  },
};

// Cache keys prefix
export const CACHE_KEYS = {
  PROCESSO: 'processo',
  MOVIMENTACOES: 'movimentacoes',
  PARTES: 'partes',
  TRIBUNAL_STATUS: 'tribunal:status',
  OAB_PROCESSOS: 'oab:processos',
  FIRECRAWL_AUX: 'firecrawl:aux',
} as const;

// Cache TTL in seconds
export const CACHE_TTL = {
  PROCESSO: 3600, // 1 hour
  MOVIMENTACOES: 900, // 15 minutes
  PARTES: 3600, // 1 hour
  TRIBUNAL_STATUS: 300, // 5 minutes
  OAB_PROCESSOS: 1800, // 30 minutes
  FIRECRAWL_AUX: 86400, // 24 hours
} as const;

export default cache;
