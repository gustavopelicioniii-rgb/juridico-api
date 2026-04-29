/**
 * Testes unitários para CrawlerResilience
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  CircuitBreaker,
  CircuitState,
  RetryPolicy,
  RateLimiter,
  BrowserPool,
} from '../../src/services/CrawlerResilience';

describe('CircuitBreaker', () => {
  let circuit: CircuitBreaker;

  beforeEach(() => {
    circuit = new CircuitBreaker('test', {
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 1000,
      halfOpenMaxCalls: 1,
    });
  });

  describe('estado inicial', () => {
    it('deve iniciar no estado CLOSED', () => {
      expect(circuit.getStats().state).toBe(CircuitState.CLOSED);
    });

    it('deve ter 0 falhas iniciais', () => {
      expect(circuit.getStats().failures).toBe(0);
    });
  });

  describe('execução normal', () => {
    it('deve executar função com sucesso', async () => {
      const fn = jest.fn().mockResolvedValue('sucesso');
      const fallback = jest.fn().mockResolvedValue('fallback');

      const result = await circuit.execute(fn, fallback);

      expect(result).toBe('sucesso');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fallback).not.toHaveBeenCalled();
    });

    it('deve chamar fallback quando função falha', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('falha'));
      const fallback = jest.fn().mockResolvedValue('fallback');

      const result = await circuit.execute(fn, fallback);

      expect(result).toBe('fallback');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('abertura do circuito', () => {
    it('deve abrir após failureThreshold falhas', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('falha'));
      const fallback = jest.fn().mockResolvedValue('fallback');

      for (let i = 0; i < 3; i++) {
        await circuit.execute(fn, fallback);
      }

      expect(circuit.getStats().state).toBe(CircuitState.OPEN);
    });

    it('deve falhar rapidamente quando circuito aberto', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('falha'));
      const fallback = jest.fn().mockResolvedValue('fallback');

      // Abre o circuito
      for (let i = 0; i < 3; i++) {
        await circuit.execute(fn, fallback);
      }

      // Reseta para testar
      circuit = new CircuitBreaker('test', {
        failureThreshold: 1,
        successThreshold: 1,
        timeout: 100,
        halfOpenMaxCalls: 1,
      });

      // Executa uma vez para abrir
      await circuit.execute(fn, fallback);

      // Segunda execução deve usar fallback diretamente
      const result = await circuit.execute(fn, fallback);

      expect(result).toBe('fallback');
      expect(fn).toHaveBeenCalledTimes(1); // Apenas a primeira chamada
    });
  });

  describe('reset()', () => {
    it('deve resetar circuito para estado inicial', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('falha'));
      const fallback = jest.fn().mockResolvedValue('fallback');

      // Causa algumas falhas
      for (let i = 0; i < 3; i++) {
        await circuit.execute(fn, fallback);
      }

      expect(circuit.getStats().failures).toBeGreaterThan(0);

      circuit.reset();

      expect(circuit.getStats().state).toBe(CircuitState.CLOSED);
      expect(circuit.getStats().failures).toBe(0);
    });
  });
});

describe('RetryPolicy', () => {
  let retry: RetryPolicy;

  beforeEach(() => {
    retry = new RetryPolicy({
      maxAttempts: 3,
      initialDelayMs: 10,
      maxDelayMs: 100,
      backoffMultiplier: 2,
    });
  });

  describe('execução bem-sucedida', () => {
    it('deve retornar resultado na primeira tentativa', async () => {
      const fn = jest.fn().mockResolvedValue('sucesso');

      const result = await retry.execute(fn);

      expect(result).toBe('sucesso');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('retry em caso de erro', () => {
    it('deve tentar novamente em caso de erro retryável', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockResolvedValue('sucesso');

      const result = await retry.execute(fn);

      expect(result).toBe('sucesso');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('deve parar após maxAttempts', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('ETIMEDOUT'));

      await expect(retry.execute(fn)).rejects.toThrow('ETIMEDOUT');
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('erros não-retryáveis', () => {
    it('deve não fazer retry para erros não-configurados', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('INVALID_ARGUMENT'));

      await expect(retry.execute(fn)).rejects.toThrow('INVALID_ARGUMENT');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({
      maxRequests: 3,
      windowMs: 1000,
    });
  });

  afterEach(() => {
    limiter.destroy();
  });

  describe('aquisição de slots', () => {
    it('deve permitir primeiras requisições', async () => {
      const result1 = await limiter.acquire('test');
      const result2 = await limiter.acquire('test');
      const result3 = await limiter.acquire('test');

      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(result3).toBe(true);
    });

    it('deve bloquear após limite atingido', async () => {
      await limiter.acquire('test');
      await limiter.acquire('test');
      await limiter.acquire('test');

      const result = await limiter.acquire('test');

      expect(result).toBe(false);
    });

    it('deve permitir após reset', async () => {
      await limiter.acquire('test');
      await limiter.acquire('test');
      await limiter.acquire('test');

      limiter.reset('test');

      const result = await limiter.acquire('test');
      expect(result).toBe(true);
    });
  });

  describe('getRemaining', () => {
    it('deve retornar slots restantes corretos', async () => {
      expect(limiter.getRemaining('test')).toBe(3);

      await limiter.acquire('test');
      expect(limiter.getRemaining('test')).toBe(2);

      await limiter.acquire('test');
      expect(limiter.getRemaining('test')).toBe(1);
    });
  });
});

describe('BrowserPool', () => {
  let pool: BrowserPool;

  afterEach(async () => {
    await pool.destroy();
  });

  describe('stats', () => {
    it('deve iniciar com stats zerados', () => {
      pool = new BrowserPool({
        minBrowsers: 0,
        maxBrowsers: 0,
      });

      const stats = pool.getStats();

      expect(stats.total).toBe(0);
      expect(stats.inUse).toBe(0);
      expect(stats.available).toBe(0);
    });
  });
});
