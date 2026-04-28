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
  });

  describe('healthCheck', () => {
    it('should return boolean', async () => {
      const result = await adapter.healthCheck();
      expect(typeof result).toBe('boolean');
    });
  });
});
