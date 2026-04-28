import { describe, it, expect } from '@jest/globals';
import { TJSPAdapter } from '../../src/tribunais/TJSPAdapter';

describe('TJSPAdapter', () => {
  const adapter = new TJSPAdapter();

  describe('properties', () => {
    it('should have correct codigo', () => {
      expect(adapter.codigo).toBe('TJSP');
    });

    it('should not use captcha', () => {
      expect(adapter.usaCaptcha).toBe(false);
    });

    it('should have correct nome', () => {
      expect(adapter.nome).toBe('Tribunal de Justiça de São Paulo');
    });
  });

  describe('validarNumeroProcesso', () => {
    it('should validate TJSP format (NNNNNNN-DD.YYYY.J.TR.OOOO)', () => {
      const validNumber = '1000123-45.2024.8.26.0101';
      expect(adapter.validarNumeroProcesso(validNumber)).toBe(true);
    });

    it('should reject invalid format', () => {
      const invalidNumber = 'invalid';
      expect(adapter.validarNumeroProcesso(invalidNumber)).toBe(false);
    });

    it('should reject empty string', () => {
      expect(adapter.validarNumeroProcesso('')).toBe(false);
    });
  });

  describe('formatarNumeroProcesso', () => {
    it('should keep already formatted number', () => {
      const numero = '1000123-45.2024.8.26.0101';
      expect(adapter.formatarNumeroProcesso(numero)).toBe(numero);
    });
  });

  describe('healthCheck', () => {
    it('should return boolean', async () => {
      const result = await adapter.healthCheck();
      expect(typeof result).toBe('boolean');
    });
  });
});
