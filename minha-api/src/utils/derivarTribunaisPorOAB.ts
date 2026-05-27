/**
 * Deriva tribunais relevantes a partir da UF presente na OAB (ex.: RJ163351).
 * Advogados do RJ costumam ter processos no TJRJ, TRT1, TRF2 e TRE-RJ.
 */

const UF_PARA_TRIBUNAIS: Record<string, string[]> = {
  AC: ['TJAC', 'TRF1'],
  AL: ['TJAL', 'TRF5'],
  AM: ['TJAM', 'TRF1', 'TREAM'],
  AP: ['TJAP', 'TRF1', 'TREAP'],
  BA: ['TJBA', 'TRF1', 'TREBA'],
  CE: ['TJCE', 'TRF5', 'TRECE'],
  DF: ['TJDFT', 'TRF1', 'TREDF'],
  ES: ['TJES', 'TRF2', 'TREES'],
  GO: ['TJGO', 'TRF1', 'TREGO'],
  MA: ['TJMA', 'TRF1', 'TREMA'],
  MG: ['TJMG', 'TRT3', 'TRF6', 'TREMG'],
  MS: ['TJMS', 'TRF3', 'TREMS'],
  MT: ['TJMT', 'TRF1', 'TREMT'],
  PA: ['TJPA', 'TRF1', 'TREPA'],
  PB: ['TJPB', 'TRF5', 'TREPB'],
  PE: ['TJPE', 'TRF5', 'TREPE'],
  PI: ['TJPI', 'TRF1', 'TREPI'],
  PR: ['TJPR', 'TRT9', 'TRF4', 'TREPR'],
  RJ: ['TJRJ', 'TRT1', 'TRF2', 'TRERJ'],
  RN: ['TJRN', 'TRF5', 'TRERN'],
  RO: ['TJRO', 'TRF1', 'TRERO'],
  RR: ['TJRR', 'TRF1', 'TRERR'],
  RS: ['TJRS', 'TRT4', 'TRF4', 'TRERS'],
  SC: ['TJSC', 'TRT12', 'TRF4', 'TRESC'],
  SE: ['TJSE', 'TRF5', 'TRESE'],
  SP: ['TJSP', 'TRT2', 'TRT15', 'TRF3', 'TRESP'],
  TO: ['TJTO', 'TRF1', 'TRETO'],
};

export function extrairUFDaOAB(oab: string): string | null {
  const normalized = oab.toUpperCase().replace(/\s/g, '');
  const prefix = normalized.match(/^([A-Z]{2})(\d+)/);
  if (prefix) return prefix[1];
  const suffix = normalized.match(/(\d+)([A-Z]{2})$/);
  if (suffix) return suffix[2];
  return null;
}

export function derivarTribunaisPorOAB(oab: string): string[] {
  const uf = extrairUFDaOAB(oab);
  if (!uf) return [];
  return UF_PARA_TRIBUNAIS[uf] ?? [];
}

/** Expande um tribunal TJ/TRT/TRF para o conjunto da UF quando a OAB informa a seção. */
export function expandirTribunaisPorOAB(tribunalCodigo: string, oab: string): string[] {
  const codigo = tribunalCodigo.toUpperCase();
  const derivados = derivarTribunaisPorOAB(oab);
  if (derivados.length === 0) return [codigo];
  if (derivados.includes(codigo)) return derivados;
  return [codigo];
}
