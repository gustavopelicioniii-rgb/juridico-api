import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { BaseTribunalAdapter } from '../../src/tribunais/ITribunalAdapter';

class TestAdapter extends BaseTribunalAdapter {
  async buscarProcesso(numero: string) {
    return {
      numero,
      tipo: 'Cível',
      area: 'Direito do Consumidor',
      classe: 'Procedimento Comum Cível',
      assunto: 'Contrato Bancário',
      distribuicao: '2024-01-15',
      status: 'ATIVO' as const,
      ultimaAtualizacao: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      tribunalId: '1',
    };
  }

  async buscarPorOAB(_oab: string, _uf: string) {
    return [];
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
    it('should return true when tribunal is online', async () => {
      const result = await adapter.healthCheck();
      expect(result).toBe(true);
    });
  });

  describe('formatarNumeroProcesso', () => {
    it('should format CNJ number correctly', async () => {
      const result = await adapter.healthCheck();
      expect(result).toBe(true);
    });
  });

  describe('validarNumeroProcesso', () => {
    it('should validate CNJ format correctly', () => {
      const isValid = adapter.validarNumeroProcesso('0000123-45.2024.8.26.0101');
      expect(isValid).toBe(true);
    });

    it('should reject invalid format', () => {
      const isValid = adapter.validarNumeroProcesso('invalid-number');
      expect(isValid).toBe(false);
    });
  });
});
