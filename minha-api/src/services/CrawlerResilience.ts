/**
 * CrawlerResilience - Sistema de Resiliência para Crawlers
 *
 * Implementa:
 * 1. CircuitBreaker - evita chamadas consecutivas a tribunais com problemas
 * 2. RetryPolicy - tenta novamente com backoff exponencial
 * 3. RateLimiter - limita requisições por tribunal
 * 4. BrowserPool - gerencia múltiplos browsers para paralelismo
 */

import puppeteer, { Browser } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import logger from '../config/logger';

puppeteer.use(StealthPlugin());

// ============================================================
// Circuit Breaker
// ============================================================

export enum CircuitState {
  CLOSED = 'CLOSED',     // Normal - todas as chamadas passam
  OPEN = 'OPEN',         // Aberto - chamadas falham rapidamente
  HALF_OPEN = 'HALF_OPEN', // Testando - deixa uma chamada passar
}

export interface CircuitBreakerConfig {
  failureThreshold: number;      // Falhas para abrir o circuito (default: 5)
  successThreshold: number;       // Sucessos para fechar o circuito (default: 3)
  timeout: number;               // Tempo para tentar novamente em ms (default: 60000)
  halfOpenMaxCalls: number;      // Chamadas permitidas em half-open (default: 1)
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: Date | null;
  nextAttempt: Date | null;
}

class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private successes = 0;
  private nextAttempt: Date | null = null;
  private halfOpenCalls = 0;

  constructor(
    private name: string,
    private config: CircuitBreakerConfig = {
      failureThreshold: 5,
      successThreshold: 3,
      timeout: 60000,
      halfOpenMaxCalls: 1,
    }
  ) {}

  async execute<T>(fn: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (this.nextAttempt && Date.now() >= this.nextAttempt.getTime()) {
        this.state = CircuitState.HALF_OPEN;
        this.halfOpenCalls = 0;
        logger.info(`[CircuitBreaker:${this.name}] OPEN -> HALF_OPEN`);
      } else {
        logger.warn(`[CircuitBreaker:${this.name}] Circuit OPEN, usando fallback`);
        return fallback();
      }
    }

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.halfOpenCalls >= this.config.halfOpenMaxCalls) {
        logger.warn(`[CircuitBreaker:${this.name}] HALF_OPEN max calls reached, usando fallback`);
        return fallback();
      }
      this.halfOpenCalls++;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      return fallback();
    }
  }

  private onSuccess(): void {
    this.failures = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.successes = 0;
        this.nextAttempt = null;
        logger.info(`[CircuitBreaker:${this.name}] HALF_OPEN -> CLOSED`);
      }
    }
  }

  private onFailure(): void {
    this.failures++;
    this.successes = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.nextAttempt = new Date(Date.now() + this.config.timeout);
      logger.warn(`[CircuitBreaker:${this.name}] HALF_OPEN -> OPEN (will retry at ${this.nextAttempt})`);
    } else if (this.failures >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.nextAttempt = new Date(Date.now() + this.config.timeout);
      logger.error(`[CircuitBreaker:${this.name}] CLOSED -> OPEN (failures: ${this.failures})`);
    }
  }

  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.failures > 0 ? new Date() : null,
      nextAttempt: this.nextAttempt,
    };
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.nextAttempt = null;
    this.halfOpenCalls = 0;
  }
}

// ============================================================
// Retry Policy
// ============================================================

export interface RetryConfig {
  maxAttempts: number;           // Tentativas máximas (default: 3)
  initialDelayMs: number;        // Delay inicial em ms (default: 1000)
  maxDelayMs: number;            // Delay máximo em ms (default: 30000)
  backoffMultiplier: number;     // Multiplicador do backoff (default: 2)
  retryableErrors?: string[];    // Códigos de erro que merecem retry
}

const DEFAULT_RETRYABLE_ERRORS = [
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'TIMEOUT',
  'rate limit',
  '429',
  '503',
  '502',
  '504',
];

class RetryPolicy {
  constructor(private config: RetryConfig = {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
  }) {}

  async execute<T>(
    fn: () => Promise<T>,
    shouldRetry?: (error: any) => boolean
  ): Promise<T> {
    let lastError: any;
    let delay = this.config.initialDelayMs;

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;

        const shouldRetryAttempt = shouldRetry
          ? shouldRetry(error)
          : this.isRetryableError(error);

        if (!shouldRetryAttempt || attempt === this.config.maxAttempts) {
          logger.error(`[RetryPolicy] Todas as tentativas falharam: ${error.message}`);
          throw error;
        }

        logger.warn(`[RetryPolicy] Tentativa ${attempt}/${this.config.maxAttempts} falhou: ${error.message}. Retry em ${delay}ms`);

        await this.sleep(delay);
        delay = Math.min(
          delay * this.config.backoffMultiplier,
          this.config.maxDelayMs
        );
      }
    }

    throw lastError;
  }

  private isRetryableError(error: any): boolean {
    const errorMsg = (error.message || '').toLowerCase();
    const errorCode = error.code || '';

    return this.config.retryableErrors?.some(e =>
      errorMsg.includes(e.toLowerCase()) || errorCode.includes(e)
    ) ?? DEFAULT_RETRYABLE_ERRORS.some(e =>
      errorMsg.includes(e.toLowerCase()) || errorCode.includes(e)
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================
// Rate Limiter
// ============================================================

export interface RateLimiterConfig {
  maxRequests: number;        // Requisições máximas
  windowMs: number;           // Janela de tempo em ms (default: 60000 = 1min)
}

interface RateLimitEntry {
  count: number;
  resetAt: Date;
}

class RateLimiter {
  private requests: Map<string, RateLimitEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor(
    private config: RateLimiterConfig = {
      maxRequests: 10,
      windowMs: 60000,
    }
  ) {
    // Limpa entradas expiradas periodicamente
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  async acquire(key: string): Promise<boolean> {
    this.cleanup();

    const now = Date.now();
    const entry = this.requests.get(key);

    if (!entry || now >= entry.resetAt.getTime()) {
      this.requests.set(key, {
        count: 1,
        resetAt: new Date(now + this.config.windowMs),
      });
      return true;
    }

    if (entry.count >= this.config.maxRequests) {
      const waitMs = entry.resetAt.getTime() - now;
      logger.warn(`[RateLimiter:${key}] Limite atingido. Aguarde ${waitMs}ms`);
      return false;
    }

    entry.count++;
    return true;
  }

  async waitForSlot(key: string, maxWaitMs: number = 60000): Promise<boolean> {
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      if (await this.acquire(key)) {
        return true;
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    return false;
  }

  getRemaining(key: string): number {
    const entry = this.requests.get(key);
    if (!entry) return this.config.maxRequests;
    return Math.max(0, this.config.maxRequests - entry.count);
  }

  reset(key?: string): void {
    if (key) {
      this.requests.delete(key);
    } else {
      this.requests.clear();
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.requests.entries()) {
      if (now >= entry.resetAt.getTime()) {
        this.requests.delete(key);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
  }
}

// ============================================================
// Browser Pool
// ============================================================

export interface BrowserPoolConfig {
  minBrowsers: number;        // Mínimo de browsers (default: 2)
  maxBrowsers: number;        // Máximo de browsers (default: 5)
  browserIdleTimeoutMs: number; // Timeout para fechar browser ocioso (default: 120000)
  launchOptions?: puppeteer.BrowserLaunchOptions;
}

interface PooledBrowser {
  browser: Browser;
  inUse: boolean;
  lastUsed: Date;
  id: string;
}

class BrowserPool {
  private pool: PooledBrowser[] = [];
  private launching = 0;
  private readonly config: BrowserPoolConfig;

  constructor(config: BrowserPoolConfig = {
    minBrowsers: 2,
    maxBrowsers: 5,
    browserIdleTimeoutMs: 120000,
  }) {
    this.config = config;
    this.startCleanup();
  }

  async acquire(): Promise<Browser> {
    // Procura browser disponível
    for (const pb of this.pool) {
      if (!pb.inUse && pb.browser.isConnected()) {
        pb.inUse = true;
        pb.lastUsed = new Date();
        return pb.browser;
      }
    }

    // Lança novo browser se não atingiu o máximo
    if (this.pool.length < this.config.maxBrowsers) {
      return this.launchBrowser();
    }

    // Espera até um ficar disponível
    return new Promise((resolve) => {
      const checkInterval = setInterval(async () => {
        for (const pb of this.pool) {
          if (!pb.inUse && pb.browser.isConnected()) {
            clearInterval(checkInterval);
            pb.inUse = true;
            pb.lastUsed = new Date();
            resolve(pb.browser);
            return;
          }
        }
      }, 1000);
    });
  }

  release(browser: Browser): void {
    const pooled = this.pool.find(pb => pb.browser === browser);
    if (pooled) {
      pooled.inUse = false;
      pooled.lastUsed = new Date();
    }
  }

  private async launchBrowser(): Promise<Browser> {
    this.launching++;
    logger.info(`[BrowserPool] Lançando browser (${this.pool.length + 1}/${this.config.maxBrowsers})`);

    try {
      const browser = await puppeteer.launch({
        headless: true,
        ...this.config.launchOptions,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920x1080',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          ...(this.config.launchOptions?.args || []),
        ],
      });

      const pooled: PooledBrowser = {
        browser,
        inUse: true,
        lastUsed: new Date(),
        id: `browser-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      };

      this.pool.push(pooled);

      browser.on('disconnected', () => {
        this.pool = this.pool.filter(p => p.browser !== browser);
        logger.info(`[BrowserPool] Browser desconectado: ${pooled.id}`);
      });

      return browser;
    } finally {
      this.launching--;
    }
  }

  private startCleanup(): void {
    setInterval(() => this.cleanup(), 30000);
  }

  private cleanup(): void {
    const now = Date.now();

    for (const pb of this.pool) {
      if (pb.inUse) continue;

      const idleTime = now - pb.lastUsed.getTime();
      if (idleTime > this.config.browserIdleTimeoutMs && this.pool.length > this.config.minBrowsers) {
        logger.info(`[BrowserPool] Fechando browser ocioso: ${pb.id}`);
        pb.browser.close().catch(() => {});
        this.pool = this.pool.filter(p => p !== pb);
      }
    }
  }

  async destroy(): Promise<void> {
    await Promise.all(this.pool.map(pb => pb.browser.close().catch(() => {})));
    this.pool = [];
  }

  getStats(): { total: number; inUse: number; available: number } {
    return {
      total: this.pool.length,
      inUse: this.pool.filter(p => p.inUse).length,
      available: this.pool.filter(p => !p.inUse && p.browser.isConnected()).length,
    };
  }
}

// ============================================================
// Crawler Resilience Manager (Facade)
// ============================================================

export interface ResilienceConfig {
  circuitBreaker?: Partial<CircuitBreakerConfig>;
  retry?: Partial<RetryConfig>;
  rateLimit?: Partial<RateLimiterConfig>;
  browserPool?: Partial<BrowserPoolConfig>;
}

class CrawlerResilienceManager {
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private retryPolicies: Map<string, RetryPolicy> = new Map();
  private rateLimiters: Map<string, RateLimiter> = new Map();
  private browserPool: BrowserPool;

  constructor(config: ResilienceConfig = {}) {
    // Browser pool compartilhado
    this.browserPool = new BrowserPool({
      minBrowsers: config.browserPool?.minBrowsers ?? 2,
      maxBrowsers: config.browserPool?.maxBrowsers ?? 5,
      browserIdleTimeoutMs: config.browserPool?.browserIdleTimeoutMs ?? 120000,
    });
  }

  getCircuitBreaker(tribunal: string): CircuitBreaker {
    if (!this.circuitBreakers.has(tribunal)) {
      this.circuitBreakers.set(tribunal, new CircuitBreaker(
        `crawler-${tribunal}`,
        {
          failureThreshold: 5,
          successThreshold: 3,
          timeout: 60000,
          ...this.circuitBreakers.get(tribunal)?.config,
          ...config.circuitBreaker,
        }
      ));
    }
    return this.circuitBreakers.get(tribunal)!;
  }

  getRetryPolicy(tribunal: string): RetryPolicy {
    if (!this.retryPolicies.has(tribunal)) {
      this.retryPolicies.set(tribunal, new RetryPolicy({
        maxAttempts: 3,
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
        ...this.retryPolicies.get(tribunal)?.config,
        ...config.retry,
      }));
    }
    return this.retryPolicies.get(tribunal)!;
  }

  getRateLimiter(tribunal: string): RateLimiter {
    if (!this.rateLimiters.has(tribunal)) {
      this.rateLimiters.set(tribunal, new RateLimiter({
        maxRequests: 10,
        windowMs: 60000,
        ...this.rateLimiters.get(tribunal)?.config,
        ...config.rateLimit,
      }));
    }
    return this.rateLimiters.get(tribunal)!;
  }

  getBrowserPool(): BrowserPool {
    return this.browserPool;
  }

  async withResilience<T>(
    tribunal: string,
    fn: () => Promise<T>,
    fallback: () => Promise<T>
  ): Promise<T> {
    const circuitBreaker = this.getCircuitBreaker(tribunal);
    const retryPolicy = this.getRetryPolicy(tribunal);
    const rateLimiter = this.getRateLimiter(tribunal);

    // Verifica rate limit primeiro
    const allowed = await rateLimiter.acquire(tribunal);
    if (!allowed) {
      logger.warn(`[Resilience:${tribunal}] Rate limit atingido`);
      return fallback();
    }

    // Executa com circuit breaker e retry
    return circuitBreaker.execute(
      () => retryPolicy.execute(fn),
      fallback
    );
  }

  getAllStats(): Record<string, {
    circuitBreaker: CircuitBreakerStats;
    rateLimiter: { remaining: number };
  }> {
    const stats: Record<string, any> = {};

    for (const tribunal of this.circuitBreakers.keys()) {
      stats[tribunal] = {
        circuitBreaker: this.getCircuitBreaker(tribunal).getStats(),
        rateLimiter: { remaining: this.getRateLimiter(tribunal).getRemaining(tribunal) },
      };
    }

    return stats;
  }

  async destroy(): Promise<void> {
    await this.browserPool.destroy();
    this.circuitBreakers.clear();
    this.retryPolicies.clear();
    for (const rl of this.rateLimiters.values()) {
      rl.destroy();
    }
    this.rateLimiters.clear();
  }
}

export { CircuitBreaker, RetryPolicy, RateLimiter, BrowserPool };
export const resilienceManager = new CrawlerResilienceManager();
export default resilienceManager;
