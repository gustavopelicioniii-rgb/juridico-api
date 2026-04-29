/**
 * Serviço de Derivação de Tribunal por UF/OAB
 *
 * Mapeia a UF (extraída da OAB) para os tribunais corretos:
 * - TJ: Tribunal de Justiça (estadual)
 * - TRT: Tribunal Regional do Trabalho (justiça do trabalho)
 * - TRF: Tribunal Regional Federal (justiça federal)
 *
 * Referências:
 * - TJs: 27 estados + DF = 28 tribunais
 * - TRTs: 24 regiones trabalhistas
 * - TRFs: 6 regiões federais
 */

export interface TribunalInfo {
  codigo: string;
  nome: string;
  sigla: string;
  tipo: 'TJ' | 'TRT' | 'TRF' | 'STF' | 'STJ' | 'TST' | 'TSE' | 'STM';
}

export interface ResultadoDerivacao {
  uf: string;
  tribunais: TribunalInfo[];
  tribunalPrimario: TribunalInfo;
}

/**
 * Mapeamento de UF → Tribunal de Justiça (estadual)
 */
const UF_PARA_TJ: Record<string, string> = {
  SP: 'TJSP',
  RJ: 'TJRJ',
  MG: 'TJMG',
  RS: 'TJRS',
  BA: 'TJBA',
  PR: 'TJPR',
  SC: 'TJSC',
  GO: 'TJGO',
  DF: 'TJDFT',
  PE: 'TJPE',
  CE: 'TJCE',
  ES: 'TJES',
  MS: 'TJMS',
  MT: 'TJMT',
  PB: 'TJPB',
  RN: 'TJRN',
  AL: 'TJAL',
  SE: 'TJSE',
  PI: 'TJPI',
  MA: 'TJMA',
  PA: 'TJPA',
  AM: 'TJAM',
  AP: 'TJAP',
  RO: 'TJRO',
  RR: 'TJRR',
  AC: 'TJAC',
  TO: 'TJTO',
};

/**
 * Mapeamento de UF → Tribunal Regional do Trabalho
 * Fonte: https://www.tst.jus.br/web/guest/tudo-sobre-o-tst
 */
const UF_PARA_TRT: Record<string, string> = {
  // TRT 1ª Região - Rio de Janeiro
  RJ: 'TRT1',
  // TRT 2ª Região - São Paulo
  SP: 'TRT2',
  // TRT 3ª Região - Minas Gerais
  MG: 'TRT3',
  // TRT 4ª Região - Rio Grande do Sul
  RS: 'TRT4',
  // TRT 5ª Região - Bahia
  BA: 'TRT5',
  // TRT 6ª Região - Pernambuco
  PE: 'TRT6',
  // TRT 7ª Região - Ceará
  CE: 'TRT7',
  // TRT 8ª Região - Pará e Amapá
  PA: 'TRT8',
  AM: 'TRT8',
  AP: 'TRT8',
  // TRT 9ª Região - Paraná
  PR: 'TRT9',
  // TRT 10ª Região - Distrito Federal e Tocantins
  DF: 'TRT10',
  TO: 'TRT10',
  // TRT 11ª Região - Amazonas, Acre, Roraima e Rondônia
  AM: 'TRT11',
  AC: 'TRT11',
  RR: 'TRT11',
  RO: 'TRT11',
  // TRT 12ª Região - Santa Catarina
  SC: 'TRT12',
  // TRT 13ª Região - Paraíba
  PB: 'TRT13',
  // TRT 14ª Região - Rondônia e Acre (substituído pelo 11, mantendo compatibilidade)
  // RO: 'TRT14', // Antigo, unificado no TRT11
  // TRT 15ª Região - São Paulo (interior)
  // SP interior já coberto pelo TRT2 na capital, região tem cobertura própria
  // TRT 16ª Região - Maranhão
  MA: 'TRT16',
  // TRT 17ª Região - Espírito Santo
  ES: 'TRT17',
  // TRT 18ª Região - Goiás
  GO: 'TRT18',
  // TRT 19ª Região - Alagoas
  AL: 'TRT19',
  // TRT 20ª Região - Sergipe
  SE: 'TRT20',
  // TRT 21ª Região - Rio Grande do Norte
  RN: 'TRT21',
  // TRT 22ª Região - Piauí
  PI: 'TRT22',
  // TRT 23ª Região - Mato Grosso
  MT: 'TRT23',
  // TRT 24ª Região - Mato Grosso do Sul
  MS: 'TRT24',
};

/**
 * Mapeamento de UF → Tribunal Regional Federal
 * 6 regiões: TRF1 a TRF6
 */
const UF_PARA_TRF: Record<string, string> = {
  // TRF1: São Paulo e Mato Grosso do Sul
  SP: 'TRF3',
  MS: 'TRF3',
  // TRF2: Rio de Janeiro e Espírito Santo
  RJ: 'TRF2',
  ES: 'TRF2',
  // TRF3: Minas Gerais (na verdade é TRF1, arrumando)
  // Nota: TRF1 cobre DF, GO, MT, MS, TO
  // TRF3 cobre SP e MS
  MG: 'TRF1',
  // TRF4: Rio Grande do Sul, Santa Catarina, Paraná
  RS: 'TRF4',
  SC: 'TRF4',
  PR: 'TRF4',
  // TRF5: Pernambuco, Ceará, Paraíba, Rio Grande do Norte, Alagoas, Sergipe, Piauí, Maranhão
  PE: 'TRF5',
  CE: 'TRF5',
  PB: 'TRF5',
  RN: 'TRF5',
  AL: 'TRF5',
  SE: 'TRF5',
  PI: 'TRF5',
  MA: 'TRF5',
  // TRF6: Amazonas, Pará, Acre, Roraima, Amapá, Rondônia, Goiás, Tocantins, Distrito Federal, Mato Grosso
  PA: 'TRF6',
  AM: 'TRF6',
  AP: 'TRF6',
  RR: 'TRF6',
  RO: 'TRF6',
  GO: 'TRF6',
  TO: 'TRF6',
  DF: 'TRF6',
  MT: 'TRF6',
};

/**
 * Nomes completos dos tribunais
 */
const TRIBUNAL_NAMES: Record<string, string> = {
  // TJs
  TJSP: 'Tribunal de Justiça de São Paulo',
  TJRJ: 'Tribunal de Justiça do Rio de Janeiro',
  TJMG: 'Tribunal de Justiça de Minas Gerais',
  TJRS: 'Tribunal de Justiça do Rio Grande do Sul',
  TJBA: 'Tribunal de Justiça da Bahia',
  TJPR: 'Tribunal de Justiça do Paraná',
  TJSC: 'Tribunal de Justiça de Santa Catarina',
  TJGO: 'Tribunal de Justiça de Goiás',
  TJDFT: 'Tribunal de Justiça do Distrito Federal e Territórios',
  TJPE: 'Tribunal de Justiça de Pernambuco',
  TJCE: 'Tribunal de Justiça do Ceará',
  TJES: 'Tribunal de Justiça do Espírito Santo',
  TJMS: 'Tribunal de Justiça do Mato Grosso do Sul',
  TJMT: 'Tribunal de Justiça do Mato Grosso',
  TJPB: 'Tribunal de Justiça da Paraíba',
  TJRN: 'Tribunal de Justiça do Rio Grande do Norte',
  TJAL: 'Tribunal de Justiça de Alagoas',
  TJSE: 'Tribunal de Justiça de Sergipe',
  TJPI: 'Tribunal de Justiça do Piauí',
  TJMA: 'Tribunal de Justiça do Maranhão',
  TJPA: 'Tribunal de Justiça do Pará',
  TJAM: 'Tribunal de Justiça do Amazonas',
  TJAP: 'Tribunal de Justiça do Amapá',
  TJRO: 'Tribunal de Justiça de Rondônia',
  TJRR: 'Tribunal de Justiça de Roraima',
  TJAC: 'Tribunal de Justiça do Acre',
  TJTO: 'Tribunal de Justiça do Tocantins',
  // TRTs
  TRT1: 'Tribunal Regional do Trabalho 1ª Região - RJ',
  TRT2: 'Tribunal Regional do Trabalho 2ª Região - SP',
  TRT3: 'Tribunal Regional do Trabalho 3ª Região - MG',
  TRT4: 'Tribunal Regional do Trabalho 4ª Região - RS',
  TRT5: 'Tribunal Regional do Trabalho 5ª Região - BA',
  TRT6: 'Tribunal Regional do Trabalho 6ª Região - PE',
  TRT7: 'Tribunal Regional do Trabalho 7ª Região - CE',
  TRT8: 'Tribunal Regional do Trabalho 8ª Região - PA/AP',
  TRT9: 'Tribunal Regional do Trabalho 9ª Região - PR',
  TRT10: 'Tribunal Regional do Trabalho 10ª Região - DF/TO',
  TRT11: 'Tribunal Regional do Trabalho 11ª Região - AM/AC/RR/RO',
  TRT12: 'Tribunal Regional do Trabalho 12ª Região - SC',
  TRT13: 'Tribunal Regional do Trabalho 13ª Região - PB',
  TRT16: 'Tribunal Regional do Trabalho 16ª Região - MA',
  TRT17: 'Tribunal Regional do Trabalho 17ª Região - ES',
  TRT18: 'Tribunal Regional do Trabalho 18ª Região - GO',
  TRT19: 'Tribunal Regional do Trabalho 19ª Região - AL',
  TRT20: 'Tribunal Regional do Trabalho 20ª Região - SE',
  TRT21: 'Tribunal Regional do Trabalho 21ª Região - RN',
  TRT22: 'Tribunal Regional do Trabalho 22ª Região - PI',
  TRT23: 'Tribunal Regional do Trabalho 23ª Região - MT',
  TRT24: 'Tribunal Regional do Trabalho 24ª Região - MS',
  // TRFs
  TRF1: 'Tribunal Regional Federal 1ª Região - MG/GO/DF/MT/TO',
  TRF2: 'Tribunal Regional Federal 2ª Região - RJ/ES',
  TRF3: 'Tribunal Regional Federal 3ª Região - SP/MS',
  TRF4: 'Tribunal Regional Federal 4ª Região - RS/SC/PR',
  TRF5: 'Tribunal Regional Federal 5ª Região - PE/CE/PB/RN/AL/SE/PI/MA',
  TRF6: 'Tribunal Regional Federal 6ª Região - PA/AP/AM/RR/RO/GO/TO/DF/MT',
  // Superiores
  STF: 'Supremo Tribunal Federal',
  STJ: 'Superior Tribunal de Justiça',
  TST: 'Tribunal Superior do Trabalho',
  TSE: 'Tribunal Superior Eleitoral',
  STM: 'Tribunal Superior Militar',
};

/**
 * Determina o tipo de tribunal pelo código
 */
function getTipoTribunal(codigo: string): TribunalInfo['tipo'] {
  if (codigo.startsWith('TJ')) return 'TJ';
  if (codigo.startsWith('TRT')) return 'TRT';
  if (codigo.startsWith('TRF')) return 'TRF';
  if (codigo === 'STF') return 'STF';
  if (codigo === 'STJ') return 'STJ';
  if (codigo === 'TST') return 'TST';
  if (codigo === 'TSE') return 'TSE';
  if (codigo === 'STM') return 'STM';
  return 'TJ';
}

/**
 * Extrai a UF de uma OAB
 * @param oab Exemplo: "361329 SP" ou "361329" ou "SP361329"
 */
export function extrairUFOAB(oab: string): string | undefined {
  const cleaned = oab.trim().toUpperCase();
  
  // Formato: "123456 UF"
  const parts = cleaned.split(/\s+/);
  if (parts.length >= 2) {
    const possibleUF = parts[parts.length - 1];
    if (/^[A-Z]{2}$/.test(possibleUF)) {
      return possibleUF;
    }
  }
  
  // Formato: "UF123456" (últimos 2 chars se parecerem UF)
  const match = cleaned.match(/([A-Z]{2})$/);
  if (match) {
    return match[1];
  }
  
  return undefined;
}

/**
 * Deriva os tribunais relevantes para uma UF
 * Retorna TJ, TRT e TRF da UF
 */
export function derivarTribunaisPorUF(uf: string): TribunalInfo[] {
  const ufUpper = uf.toUpperCase();
  const tribunais: TribunalInfo[] = [];
  
  // TJ (estadual)
  const tj = UF_PARA_TJ[ufUpper];
  if (tj) {
    tribunais.push({
      codigo: tj,
      nome: TRIBUNAL_NAMES[tj] || `Tribunal de Justiça de ${ufUpper}`,
      sigla: tj,
      tipo: 'TJ',
    });
  }
  
  // TRT (trabalhista)
  const trt = UF_PARA_TRT[ufUpper];
  if (trt) {
    tribunais.push({
      codigo: trt,
      nome: TRIBUNAL_NAMES[trt] || `Tribunal Regional do Trabalho de ${ufUpper}`,
      sigla: trt,
      tipo: 'TRT',
    });
  }
  
  // TRF (federal)
  const trf = UF_PARA_TRF[ufUpper];
  if (trf) {
    tribunais.push({
      codigo: trf,
      nome: TRIBUNAL_NAMES[trf] || `Tribunal Regional Federal de ${ufUpper}`,
      sigla: trf,
      tipo: 'TRF',
    });
  }
  
  return tribunais;
}

/**
 * Deriva os tribunais para uma OAB
 * Se a OAB tiver UF, usa ela. Senão, retorna todos os tribunais (busca geral).
 */
export function derivarTribunaisPorOAB(oab: string): ResultadoDerivacao | null {
  const uf = extrairUFOAB(oab);
  
  if (!uf) {
    // Sem UF: retorna null para indicar busca geral
    return null;
  }
  
  const tribunais = derivarTribunaisPorUF(uf);
  
  if (tribunais.length === 0) {
    return null;
  }
  
  return {
    uf,
    tribunais,
    tribunalPrimario: tribunais[0], // TJ é sempre primeiro
  };
}

/**
 * Retorna lista de todos os tribunais disponíveis para busca
 * Se tiver UF, retorna apenas os tribunais daquela UF.
 * Se não tiver UF, retorna todos os tribunais.
 */
export function getTribunaisParaBusca(oab: string, tribunaisEspecificos?: string[]): string[] {
  // Se forem especificados tribunais, usa eles
  if (tribunaisEspecificos && tribunaisEspecificos.length > 0) {
    return tribunaisEspecificos;
  }
  
  // Tenta derivar pela UF
  const derivacao = derivarTribunaisPorOAB(oab);
  if (derivacao) {
    return derivacao.tribunais.map(t => t.codigo);
  }
  
  // Sem UF: retorna null para indicar que deve buscar em todos
  return [];
}

/**
 * Retorna todos os códigos de tribunal suportados
 */
export function getTodosTribunais(): string[] {
  return [
    // TJs
    ...Object.values(UF_PARA_TJ),
    // TRTs
    ...Object.values(UF_PARA_TRT).filter((v, i, a) => a.indexOf(v) === i), // unique
    // TRFs
    ...Object.values(UF_PARA_TRF).filter((v, i, a) => a.indexOf(v) === i), // unique
    // Superiores
    'STF', 'STJ', 'TST', 'TSE', 'STM',
  ];
}
