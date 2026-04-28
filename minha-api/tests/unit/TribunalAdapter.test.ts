import { describe, it, expect, beforeEach } from '@jest/globals';
import { BaseTribunalAdapter, DadosProcesso, ResultadoBusca } from '../../src/tribunais/ITribunalAdapter';

class TestAdapter extends BaseTribunalAdapter {
  codigo = 'TEST';
  usaCaptcha = false;

  async buscarProcesso(numero: string): Promise<DadosProcesso> {
    return {
      numeroProcesso: numero,
      tribunalCodigo: 'TEST',
      classe: 'Procedimento Comum Cível',
      assunto: 'Contrato Bancário',
      partes: [],
      movimentacoes: [],
      dadosOriginais: {},
    };
  }

  async buscarPorOAB(_oab: string): Promise<ResultadoBusca> {
    return { processos: [], total: 0 };
  }
}

describe('BaseTribunalAdapter', () => {
  let adapter: TestAdapter;

  beforeEach(() => {
    adapter = new TestAdapter('https://test.tj.jus.br', 'test-api-key');
  });

  describe('constructor', () => {
    it('should create adapter with baseUrl', () => {
      expect(adapter).toBeDefined();
    });
  });

  describe('healthCheck', () => {
    it('should return true when health check succeeds', async () => {
      const result = await adapter.healthCheck();
      expect(result).toBe(true);
    });
  });
});
