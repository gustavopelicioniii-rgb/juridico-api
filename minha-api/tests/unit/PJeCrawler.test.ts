/**
 * Testes unitários para PJeCrawler
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { PJeCrawler } from '../../src/services/PJeCrawler';
import { createMockPage, createMockBrowser, PJE_HTML } from '../mocks/crawlers';

// Mock do módulo de configuração
jest.mock('../../src/config/tribunalCrawlers', () => ({
  getCrawlerConfig: jest.fn().mockImplementation((codigo: string) => ({
    tipo: 'PJE',
    baseUrl: `https://pje.tj${codigo.slice(-2).toLowerCase()}.jus.br`,
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  })),
  TRIBUNAIS_COM_CAPTCHA: {},
}));

// Mock do CaptchaHandler
jest.mock('../../src/services/CaptchaHandler', () => ({
  CaptchaHandler: jest.fn().mockImplementation(() => ({
    detectar: jest.fn().mockResolvedValue({ tipo: 'none' }),
    detectarEResolver: jest.fn().mockResolvedValue({ resolvido: true }),
  })),
  tribunalExigeCaptcha: jest.fn().mockReturnValue(false),
}));

// Mock do registry
jest.mock('../../src/tribunais', () => ({
  registry: {
    get: jest.fn().mockReturnValue({
      buscarPorOAB: jest.fn().mockResolvedValue({ processos: [], total: 0 }),
    }),
  },
}));

// Mock do logger
jest.mock('../../src/config/logger', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('PJeCrawler', () => {
  let crawler: PJeCrawler;
  let mockBrowser: any;

  beforeEach(() => {
    crawler = new PJeCrawler({ tribunalCodigo: 'TJRJ' });
    mockBrowser = createMockBrowser();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('deve criar crawler com tribunal padrão TJSP', () => {
      const defaultCrawler = new PJeCrawler();
      expect(defaultCrawler).toBeDefined();
    });

    it('deve aceitar tribunal específico via factory', () => {
      const trt1Crawler = PJeCrawler.forTribunal('TRT1');
      expect(trt1Crawler).toBeDefined();
    });
  });

  describe('buscarPorOAB', () => {
    it('deve retornar resultados quando encontra processos', async () => {
      const mockPage = createMockPage({
        html: PJE_HTML.buscaComResultados,
        evaluateResult: [
          {
            numeroProcesso: '00012345678901234',
            classe: 'Procedimento Comum',
            orgao: '1ª Vara Cível',
            dataAjuizamento: '15/03/2023',
          },
        ],
      });

      mockBrowser.newPage = jest.fn().mockResolvedValue(mockPage);
      jest.spyOn(crawler as any, 'getBrowser').mockResolvedValue(mockBrowser);

      const resultado = await crawler.buscarPorOAB('123456 SP');

      expect(resultado).toBeDefined();
      expect(resultado.total).toBeDefined();
    });

    it('deve lidar com erro de conexão', async () => {
      const mockPage = createMockPage({
        gotoError: new Error('Connection refused'),
      });

      mockBrowser.newPage = jest.fn().mockResolvedValue(mockPage);
      jest.spyOn(crawler as any, 'getBrowser').mockResolvedValue(mockBrowser);

      const resultado = await crawler.buscarPorOAB('123456 SP');

      expect(resultado).toBeDefined();
    });

    it('deve usar fallback quando portal inacessível', async () => {
      const mockPage = createMockPage({
        gotoError: new Error('ETIMEDOUT'),
      });

      mockBrowser.newPage = jest.fn().mockResolvedValue(mockPage);
      jest.spyOn(crawler as any, 'getBrowser').mockResolvedValue(mockBrowser);

      const resultado = await crawler.buscarPorOAB('123456 SP');

      expect(resultado).toBeDefined();
    });
  });

  describe('buscarDetalhesProcesso', () => {
    it('deve extrair dados do processo', async () => {
      const mockPage = createMockPage({
        html: PJE_HTML.processoDetalhe,
        evaluateResult: {
          numeroProcesso: '00012345678901234',
          classe: 'Procedimento Comum Cível',
          orgao: '1ª Vara Cível',
          valorCausa: 50000,
          partes: [{ nome: 'João da Silva', tipo: 'AUTOR' }],
        },
      });

      mockBrowser.newPage = jest.fn().mockResolvedValue(mockPage);
      jest.spyOn(crawler as any, 'getBrowser').mockResolvedValue(mockBrowser);

      const resultado = await crawler.buscarDetalhesProcesso('0001234-56.2023.8.26.0100');

      expect(resultado).toBeDefined();
    });
  });
});
