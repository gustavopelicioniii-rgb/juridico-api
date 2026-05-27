import {
  derivarTribunaisPorOAB,
  expandirTribunaisPorOAB,
  extrairUFDaOAB,
} from '../../src/utils/derivarTribunaisPorOAB';

describe('derivarTribunaisPorOAB utils', () => {
  it('extrai UF com prefixo e sufixo', () => {
    expect(extrairUFDaOAB('RJ163351')).toBe('RJ');
    expect(extrairUFDaOAB('163351RJ')).toBe('RJ');
  });

  it('deriva tribunais esperados para OAB do RJ', () => {
    expect(derivarTribunaisPorOAB('RJ163351')).toEqual(['TJRJ', 'TRT1', 'TRF2', 'TRERJ']);
  });

  it('retorna vazio quando OAB não contém UF', () => {
    expect(derivarTribunaisPorOAB('163351')).toEqual([]);
  });

  it('expande para conjunto da UF quando tribunal pertence à derivação', () => {
    expect(expandirTribunaisPorOAB('TJRJ', 'RJ163351')).toEqual(['TJRJ', 'TRT1', 'TRF2', 'TRERJ']);
  });

  it('mantém tribunal original quando ele não pertence à derivação', () => {
    expect(expandirTribunaisPorOAB('TJSP', 'RJ163351')).toEqual(['TJSP']);
  });
});
