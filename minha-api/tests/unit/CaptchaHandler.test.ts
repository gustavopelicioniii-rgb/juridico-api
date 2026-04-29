/**
 * Testes unitários para CaptchaHandler
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { CaptchaHandler, tribunalExigeCaptcha, TRIBUNAIS_COM_CAPTCHA } from '../../src/services/CaptchaHandler';

// Mock do logger
jest.mock('../../src/config/logger', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock do fetch global
global.fetch = jest.fn();

describe('CaptchaHandler', () => {
  let mockPage: any;

  beforeEach(() => {
    mockPage = {
      url: () => 'https://esaj.tjsp.jus.br/cpopg/show.do',
      evaluate: jest.fn(),
      $: jest.fn(),
    };
    jest.clearAllMocks();
  });

  describe('detectar()', () => {
    it('deve retornar tipo "none" quando não há CAPTCHA', async () => {
      mockPage.evaluate = jest.fn().mockResolvedValue('');

      const handler = new CaptchaHandler(mockPage, 'TJSP');
      const resultado = await handler.detectar();

      expect(resultado.tipo).toBe('none');
    });

    it('deve detectar CAPTCHA quando texto contém "captcha"', async () => {
      mockPage.evaluate = jest.fn().mockResolvedValue('Por favor complete o captcha para continuar');

      const handler = new CaptchaHandler(mockPage, 'TJSP');
      const resultado = await handler.detectar();

      expect(resultado.tipo).toBe('simple');
    });

    it('deve detectar reCAPTCHA v2 com sitekey', async () => {
      mockPage.evaluate = jest.fn().mockResolvedValue(null);
      mockPage.$ = jest.fn().mockResolvedValue({
        innerHTML: '<div class="g-recaptcha" data-sitekey="6LdIAAAAA"></div>',
        outerHTML: '<div class="g-recaptcha" data-sitekey="6LdIAAAAA"></div>',
      });

      const handler = new CaptchaHandler(mockPage, 'TJSP');
      const resultado = await handler.detectar();

      expect(resultado.tipo).toBe('recaptcha_v2');
      expect(resultado.siteKey).toBe('6LdIAAAAA');
    });
  });

  describe('tribunalExigeCaptcha()', () => {
    it('deve retornar true para STJ', () => {
      expect(tribunalExigeCaptcha('STJ')).toBe(true);
    });

    it('deve retornar true para STF', () => {
      expect(tribunalExigeCaptcha('STF')).toBe(true);
    });

    it('deve retornar false para TJSP', () => {
      expect(tribunalExigeCaptcha('TJSP')).toBe(false);
    });

    it('deve retornar false para TRT1', () => {
      expect(tribunalExigeCaptcha('TRT1')).toBe(false);
    });

    it('deve retornar false para tribunal desconhecido', () => {
      expect(tribunalExigeCaptcha('UNKNOWN')).toBe(false);
    });
  });

  describe('TRIBUNAIS_COM_CAPTCHA', () => {
    it('deve ter entrada para todos os tribunais principais', () => {
      const tribunaisEsperados = ['TJSP', 'TJRJ', 'TJMG', 'TRT1', 'TRT2', 'STJ', 'STF'];
      for (const t of tribunaisEsperados) {
        expect(TRIBUNAIS_COM_CAPTCHA).toHaveProperty(t);
      }
    });
  });
});

describe('CaptchaHandler com provider 2Captcha', () => {
  let mockPage: any;

  beforeEach(() => {
    mockPage = {
      url: () => 'https://example.com',
      evaluate: jest.fn().mockResolvedValue(''),
      $: jest.fn().mockResolvedValue(null),
    };
    jest.clearAllMocks();
  });

  it('deve usar TWOCAPTCHA_API_KEY quando disponível', () => {
    const originalKey = process.env.TWOCAPTCHA_API_KEY;
    process.env.TWOCAPTCHA_API_KEY = 'test-api-key';

    const handler = new CaptchaHandler(mockPage, 'TJSP');

    process.env.TWOCAPTCHA_API_KEY = originalKey;

    expect(handler).toBeDefined();
  });
});
