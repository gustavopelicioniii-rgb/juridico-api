/**
 * Configuração de URLs de crawlers por tribunal
 *
 * Cada tribunal pode ter diferentes portais:
 * - ESAJ (e-SAJ): Tribunal de Justiça com sistema e-SAJ
 * - PJe: Sistema PJe (Processo Judicial Eletrônico)
 * - Outros sistemas específicos
 *
 * Formato de URL: base do portal + path da consulta
 */

export interface CrawlerConfig {
  tipo: 'ESAJ' | 'PJE' | 'SPGB' | 'OTHER';
  baseUrl: string;
  paths: {
    buscaOAB?: string;
    detalheProcesso?: string;
  };
}

/**
 * Mapeamento de tribunais para configurações de crawler
 */
export const TRIBUNAL_CRAWLER_CONFIG: Record<string, CrawlerConfig> = {
  // ============ TRIBUNAIS DE JUSTIÇA (TJ) ============

  // TJSP - São Paulo (ESAJ e PJe)
  TJSP: {
    tipo: 'ESAJ',
    baseUrl: 'https://esaj.tjsp.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },
  // TJSP PJe
  'TJSP-PJE': {
    tipo: 'PJE',
    baseUrl: 'https://pje.tjsp.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TJRJ - Rio de Janeiro (PJe)
  TJRJ: {
    tipo: 'PJE',
    baseUrl: 'https://pje.tjrj.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TJMG - Minas Gerais (ESAJ)
  TJMG: {
    tipo: 'ESAJ',
    baseUrl: 'https://www.tjmg.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },

  // TJRS - Rio Grande do Sul (ESAJ)
  TJRS: {
    tipo: 'ESAJ',
    baseUrl: 'https://www.tjrs.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },

  // TJPR - Paraná (ESAJ)
  TJPR: {
    tipo: 'ESAJ',
    baseUrl: 'https://www.tjpr.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },

  // TJBA - Bahia (ESAJ)
  TJBA: {
    tipo: 'ESAJ',
    baseUrl: 'https://www.tjba.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },

  // TJSC - Santa Catarina (ESAJ)
  TJSC: {
    tipo: 'ESAJ',
    baseUrl: 'https://www.tjsc.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },

  // TJGO - Goiás (ESAJ)
  TJGO: {
    tipo: 'ESAJ',
    baseUrl: 'https://www.tjgo.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },

  // TJDFT - Distrito Federal (ESAJ)
  TJDFT: {
    tipo: 'ESAJ',
    baseUrl: 'https://www.tjdft.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },

  // TJPE - Pernambuco (ESAJ)
  TJPE: {
    tipo: 'ESAJ',
    baseUrl: 'https://www.tjpe.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },

  // TJCE - Ceará (ESAJ)
  TJCE: {
    tipo: 'ESAJ',
    baseUrl: 'https://www.tjce.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },

  // TJES - Espírito Santo (ESAJ)
  TJES: {
    tipo: 'ESAJ',
    baseUrl: 'https://www.tjes.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },

  // TJMS - Mato Grosso do Sul (ESAJ)
  TJMS: {
    tipo: 'ESAJ',
    baseUrl: 'https://www.tjms.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },

  // TJMT - Mato Grosso (ESAJ)
  TJMT: {
    tipo: 'ESAJ',
    baseUrl: 'https://www.tjmt.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },

  // Demais TJs - usam ESAJ genérico baseado no padrão
  TJPB: {
    tipo: 'ESAJ',
    baseUrl: 'https://www.tjpb.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },
  TJRN: {
    tipo: 'ESAJ',
    baseUrl: 'https://www.tjrn.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },
  TJAL: {
    tipo: 'ESAJ',
    baseUrl: 'https://www.tjal.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },
  TJSE: {
    tipo: 'ESAJ',
    baseUrl: 'https://www.tjse.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },
  TJPI: {
    tipo: 'ESAJ',
    baseUrl: 'https://www.tjpi.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },
  TJMA: {
    tipo: 'ESAJ',
    baseUrl: 'https://www.tjma.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },
  TJPA: {
    tipo: 'ESAJ',
    baseUrl: 'https://www.tjpa.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },
  TJAM: {
    tipo: 'ESAJ',
    baseUrl: 'https://www.tjam.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },
  TJAP: {
    tipo: 'ESAJ',
    baseUrl: 'https://www.tjap.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },
  TJRO: {
    tipo: 'ESAJ',
    baseUrl: 'https://www.tjro.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },
  TJRR: {
    tipo: 'ESAJ',
    baseUrl: 'https://www.tjrr.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },
  TJAC: {
    tipo: 'ESAJ',
    baseUrl: 'https://www.tjac.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },
  TJTO: {
    tipo: 'ESAJ',
    baseUrl: 'https://www.tjto.jus.br',
    paths: {
      buscaOAB: '/cpopg/show.do',
      detalheProcesso: '/cpopg/show.do?processo.numero=',
    },
  },

  // ============ TRIBUNAIS REGIONAIS DO TRABALHO (TRT) ============

  // TRT1 - Rio de Janeiro
  TRT1: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trt1.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRT2 - São Paulo
  TRT2: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trt2.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRT3 - Minas Gerais
  TRT3: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trt3.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRT4 - Rio Grande do Sul
  TRT4: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trt4.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRT5 - Bahia
  TRT5: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trt5.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRT6 - Pernambuco
  TRT6: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trt6.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRT7 - Ceará
  TRT7: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trt7.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRT8 - Pará/Amapá
  TRT8: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trt8.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRT9 - Paraná
  TRT9: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trt9.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRT10 - Distrito Federal/Tocantins
  TRT10: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trt10.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRT11 - Amazonas/Acre/Roraima/Rondônia
  TRT11: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trt11.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRT12 - Santa Catarina
  TRT12: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trt12.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRT13 - Paraíba
  TRT13: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trt13.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRT14 - Rondônia (substituído pelo TRT11)
  TRT14: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trt11.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRT15 - São Paulo Interior
  TRT15: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trt15.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRT16 - Maranhão
  TRT16: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trt16.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRT17 - Espírito Santo
  TRT17: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trt17.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRT18 - Goiás
  TRT18: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trt18.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRT19 - Alagoas
  TRT19: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trt19.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRT20 - Sergipe
  TRT20: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trt20.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRT21 - Rio Grande do Norte
  TRT21: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trt21.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRT22 - Piauí
  TRT22: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trt22.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRT23 - Mato Grosso
  TRT23: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trt23.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRT24 - Mato Grosso do Sul
  TRT24: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trt24.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // ============ TRIBUNAIS REGIONAIS FEDERAIS (TRF) ============

  // TRF1 - Minas Gerais, Goiás, DF, Mato Grosso, Tocantins
  TRF1: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trf1.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRF2 - Rio de Janeiro, Espírito Santo
  TRF2: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trf2.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRF3 - São Paulo, Mato Grosso do Sul
  TRF3: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trf3.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRF4 - Rio Grande do Sul, Santa Catarina, Paraná
  TRF4: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trf4.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRF5 - Pernambuco, Ceará, Paraíba, RN, AL, SE, PI, MA
  TRF5: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trf5.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // TRF6 - Pará, Amapá, Amazonas, Roraima, Rondônia, Goiás, TO, DF, MT
  TRF6: {
    tipo: 'PJE',
    baseUrl: 'https://pje.trf6.jus.br',
    paths: {
      buscaOAB: '/pje/consulta/publica/consultaProcesso.xhtml',
      detalheProcesso: '/pje/consulta/publica/consultaProcesso.xhtml?processo=',
    },
  },

  // ============ TRIBUNAIS SUPERIORES ============

  // STJ - Superior Tribunal de Justiça
  STJ: {
    tipo: 'OTHER',
    baseUrl: 'https://www.stj.jus.br',
    paths: {
      buscaOAB: '/SCG/consulta/consulta.scgp',
      detalheProcesso: '/SCG/consulta/consulta.scgp?numero=',
    },
  },

  // STF - Supremo Tribunal Federal
  STF: {
    tipo: 'OTHER',
    baseUrl: 'https://portal.stf.jus.br',
    paths: {
      buscaOAB: '/processos/consulta-processo.asp',
      detalheProcesso: '/processos/ver-processo.asp?processo=',
    },
  },

  // TST - Tribunal Superior do Trabalho
  TST: {
    tipo: 'OTHER',
    baseUrl: 'https://www.tst.jus.br',
    paths: {
      buscaOAB: '/consult proces',
      detalheProcesso: '/consultaprocessual',
    },
  },

  // TSE - Tribunal Superior Eleitoral
  TSE: {
    tipo: 'OTHER',
    baseUrl: 'https://www.tse.jus.br',
    paths: {
      buscaOAB: '/processual/consulta/consulta-processo',
      detalheProcesso: '/processual/consulta/ver-processos',
    },
  },

  // STM - Tribunal Superior Militar
  STM: {
    tipo: 'OTHER',
    baseUrl: 'https://www.stm.jus.br',
    paths: {
      buscaOAB: '/processual/consulta',
      detalheProcesso: '/processual/ver',
    },
  },
};

/**
 * Obtém a configuração de crawler para um tribunal
 */
export function getCrawlerConfig(tribunalCodigo: string): CrawlerConfig | undefined {
  return TRIBUNAL_CRAWLER_CONFIG[tribunalCodigo.toUpperCase()];
}

/**
 * Verifica se um tribunal tem configuração de crawler
 */
export function hasCrawlerConfig(tribunalCodigo: string): boolean {
  return tribunalCodigo.toUpperCase() in TRIBUNAL_CRAWLER_CONFIG;
}

/**
 * Lista todos os tribunais com configuração de crawler
 */
export function listTribunaisComCrawler(): string[] {
  return Object.keys(TRIBUNAL_CRAWLER_CONFIG);
}
