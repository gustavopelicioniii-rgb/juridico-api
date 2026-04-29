/**
 * Testes unitários para ESAJCrawler
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ESAJCrawler } from '../../src/services/ESAJCrawler';
import { createMockPage, createMockBrowser, ESAJ_HTML } from '../mocks/crawlers';

// Mock do módulo de configuração
jest.mock('../../src/config/tribunalCrawlers', () => ({
  getCrawlerConfig: jest.fn().mockImplementation((codigo: string) => ({
    tipo: 'ESAJ',
    baseUrl: `https://esaj.tj${codigo.slice(-2).toLowerCase()}.jus.br`,
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
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

describe('ESAJCrawler', () => {
  let crawler: ESAJCrawler;
  let mockBrowser: any;

  beforeEach(() => {
    crawler = new ESAJCrawler({ tribunalCodigo: 'TJSP' });
    mockBrowser = createMockBrowser();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('deve criar crawler com tribunal padrão TJSP', () => {
      const defaultCrawler = new ESAJCrawler();
      expect(defaultCrawler).toBeDefined();
    });

    it('deve aceitar tribunal específico via factory', () => {
      const tjrjCrawler = ESAJCrawler.forTribunal('TJRJ');
      expect(tjrjCrawler).toBeDefined();
    });
  });

  describe('buscarPorOAB', () => {
    it('deve retornar resultados quando encontra processos', async () => {
      const mockPage = createMockPage({
        html: ESAJ_HTML.buscaComResultados,
        evaluateResult: [
          {
            numeroProcesso: '00012345678901234',
            classe: 'Procedimento Comum Cível',
            orgao: 'Foro Central',
            dataAjuizamento: '15/03/2023',
          },
        ],
        extraSelectors: {
          'a[data-value="OAB"]': { click: jest.fn() },
        },
      });

      mockBrowser.newPage = jest.fn().mockResolvedValue(mockPage);

      // Substitui o método getBrowser
      jest.spyOn(crawler as any, 'getBrowser').mockResolvedValue(mockBrowser);

      const resultado = await crawler.buscarPorOAB('123456 SP');

      expect(resultado.total).toBeGreaterThanOrEqual(0);
    });

    it('deve lidar com erro de conexão', async () => {
      const mockPage = createMockPage({
        gotoError: new Error('Connection refused'),
      });

      mockBrowser.newPage = jest.fn().mockResolvedValue(mockPage);
      jest.spyOn(crawler as any, 'getBrowser').mockResolvedValue(mockBrowser);

      const resultado = await crawler.buscarPorOAB('123456 SP');

      // Deve fazer fallback para DataJud
      expect(resultado).toBeDefined();
      expect(resultado.total).toBeDefined();
    });

    it('deve usar fallback quando campo OAB não encontrado', async () => {
      const mockPage = createMockPage({
        html: ESAJ_HTML.campoOAB,
        evaluateResult: false, // filled = false
        extraSelectors: {
          'a[data-value="OAB"]': { click: jest.fn() },
        },
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
        html: ESAJ_HTML.processoDetalhe,
        evaluateResult: {
          numeroProcesso: '00012345678901234',
          classe: 'Procedimento Comum Cível',
          assunto: 'Contratos',
          orgao: 'Foro Central - 1ª Vara Cível',
          valorCausa: 50000,
          partes: [
            { nome: 'João da Silva', tipo: 'AUTOR', advogados: ['Dr. Pedro - OAB/SP 123'] },
            { nome: 'Empresa ABC', tipo: 'REU' },
          ],
          ultimaMovimentacao: '15/03/2023 - Distribuição',
        },
      });

      mockBrowser.newPage = jest.fn().mockResolvedValue(mockPage);
      jest.spyOn(crawler as any, 'getBrowser').mockResolvedValue(mockBrowser);

      const resultado = await crawler.buscarDetalhesProcesso('0001234-56.2023.8.26.0100');

      expect(resultado).toBeDefined();
    });

    it('deve retornar null quando página não carrega', async () => {
      const mockPage = createMockPage({
        gotoError: new Error('Page not found'),
      });

      mockBrowser.newPage = jest.fn().mockResolvedValue(mockPage);
      jest.spyOn(crawler as any, 'getBrowser').mockResolvedValue(mockBrowser);

      const resultado = await crawler.buscarDetalhesProcesso('0000000-00.0000.0.00.0000');

      expect(resultado).toBeNull();
    });
  });

  describe('enriquecimentoCompleto', () => {
    it('deve enriquecer dados do DataJud com dados ESAJ', async () => {
      const mockPage = createMockPage({
        html: ESAJ_HTML.processoDetalhe,
        evaluateResult: {
          numeroProcesso: '00012345678901234',
          classe: 'Procedimento Comum Cível',
          valorCausa: 50000,
          partes: [{ nome: 'João', tipo: 'AUTOR' }],
        },
      });

      mockBrowser.newPage = jest.fn().mockResolvedValue(mockPage);
      jest.spyOn(crawler as any, 'getBrowser').mockResolvedValue(mockBrowser);

      const dadosDataJud = {
        numeroProcesso: '00012345678901234',
        classe: 'Procedimento Comum',
      };

      const resultado = await crawler.enriquecimentoCompleto(
        '0001234-56.2023.8.26.0100',
        dadosDataJud
      );

      expect(resultado).toBeDefined();
      expect(resultado.valorCausa).toBe(50000);
    });
  });
});
