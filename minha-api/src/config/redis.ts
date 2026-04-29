import Redis from 'ioredis';
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

// Try to create Redis connection, fallback to memory cache
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  retryStrategy: (times: number) => {
    // Stop retrying after 3 attempts - use fallback
    if (times >= 3) return null;
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  enableOfflineQueue: false,
};

const redisUrl = process.env.REDIS_URL;

// Create Redis instance (prioritize REDIS_URL when provided)
const redisClient = redisUrl
  ? new Redis(redisUrl, {
    retryStrategy: redisConfig.retryStrategy,
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

redisClient.on('error', (error) => {
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
} as const;

// Cache TTL in seconds
export const CACHE_TTL = {
  PROCESSO: 3600, // 1 hour
  MOVIMENTACOES: 900, // 15 minutes
  PARTES: 3600, // 1 hour
  TRIBUNAL_STATUS: 300, // 5 minutes
  OAB_PROCESSOS: 1800, // 30 minutes
} as const;

export default cache;
