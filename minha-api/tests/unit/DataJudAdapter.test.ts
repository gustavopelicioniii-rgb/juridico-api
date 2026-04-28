/**
 * Testes do DataJudAdapter
 */

import { DataJudAdapter, DATAJUD_TRIBUNAIS } from '../../src/tribunais/DataJudAdapter';

describe('DataJudAdapter', () => {
  describe('modo MOCK (sem API key)', () => {
    let adapter: DataJudAdapter;

    beforeAll(() => {
      delete process.env.DATAJUD_API_KEY;
      adapter = new DataJudAdapter('TJSP', 'tjsp');
    });

    it('deve buscar processo válido em modo mock', async () => {
      const result = await adapter.buscarProcesso('1234567-89.2023.8.26.0100');
      expect(result.numeroProcesso).toBe('12345678920238260100');
      expect(result.tribunalCodigo).toBe('TJSP');
      expect(result.partes.length).toBeGreaterThan(0);
      expect(result.movimentacoes.length).toBeGreaterThan(0);
      expect(result.valorCausa).toBe(50000);
      expect(result.orgaoJulgador).toBeDefined();
    });

    it('deve buscar por OAB em modo mock', async () => {
      const result = await adapter.buscarPorOAB('123456');
      expect(result.processos.length).toBeGreaterThan(0);
      expect(result.total).toBeGreaterThan(0);
    });

    it('deve passar healthCheck em modo mock', async () => {
      const ok = await adapter.healthCheck();
      expect(ok).toBe(true);
    });

    it('deve rejeitar número de processo inválido', async () => {
      await expect(adapter.buscarProcesso('abc')).rejects.toThrow();
    });
  });

  describe('mapeamento DATAJUD_TRIBUNAIS', () => {
    it('deve incluir tribunais superiores', () => {
      expect(DATAJUD_TRIBUNAIS.STF).toBe('stf');
      expect(DATAJUD_TRIBUNAIS.STJ).toBe('stj');
      expect(DATAJUD_TRIBUNAIS.TST).toBe('tst');
    });

    it('deve incluir tribunais estaduais', () => {
      expect(DATAJUD_TRIBUNAIS.TJSP).toBe('tjsp');
      expect(DATAJUD_TRIBUNAIS.TJRJ).toBe('tjrj');
      expect(DATAJUD_TRIBUNAIS.TJMG).toBe('tjmg');
    });

    it('deve incluir todos os 24 TRTs', () => {
      for (let i = 1; i <= 24; i++) {
        expect(DATAJUD_TRIBUNAIS[`TRT${i}`]).toBe(`trt${i}`);
      }
    });

    it('deve incluir todos os 6 TRFs', () => {
      for (let i = 1; i <= 6; i++) {
        expect(DATAJUD_TRIBUNAIS[`TRF${i}`]).toBe(`trf${i}`);
      }
    });
  });
});
