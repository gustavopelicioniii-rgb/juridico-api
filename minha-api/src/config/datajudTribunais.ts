import { DATAJUD_TRIBUNAIS } from '../tribunais/DataJudAdapter';

export type TribunalTipo = 'TJ' | 'STJ' | 'STF' | 'TRT' | 'TRF' | 'TSE' | 'STM';

export interface TribunalSeedConfig {
  codigo: string;
  nome: string;
  baseUrl: string;
  tipo: TribunalTipo;
  usaCaptcha: boolean;
  scraperConfig: Record<string, string | boolean>;
}

const TJ_NOMES: Record<string, string> = {
  TJAC: 'Tribunal de Justiça do Acre',
  TJAL: 'Tribunal de Justiça de Alagoas',
  TJAM: 'Tribunal de Justiça do Amazonas',
  TJAP: 'Tribunal de Justiça do Amapá',
  TJBA: 'Tribunal de Justiça da Bahia',
  TJCE: 'Tribunal de Justiça do Ceará',
  TJDFT: 'Tribunal de Justiça do Distrito Federal e dos Territórios',
  TJES: 'Tribunal de Justiça do Espírito Santo',
  TJGO: 'Tribunal de Justiça de Goiás',
  TJMA: 'Tribunal de Justiça do Maranhão',
  TJMG: 'Tribunal de Justiça de Minas Gerais',
  TJMS: 'Tribunal de Justiça de Mato Grosso do Sul',
  TJMT: 'Tribunal de Justiça de Mato Grosso',
  TJPA: 'Tribunal de Justiça do Pará',
  TJPB: 'Tribunal de Justiça da Paraíba',
  TJPE: 'Tribunal de Justiça de Pernambuco',
  TJPI: 'Tribunal de Justiça do Piauí',
  TJPR: 'Tribunal de Justiça do Paraná',
  TJRJ: 'Tribunal de Justiça do Rio de Janeiro',
  TJRN: 'Tribunal de Justiça do Rio Grande do Norte',
  TJRO: 'Tribunal de Justiça de Rondônia',
  TJRR: 'Tribunal de Justiça de Roraima',
  TJRS: 'Tribunal de Justiça do Rio Grande do Sul',
  TJSC: 'Tribunal de Justiça de Santa Catarina',
  TJSE: 'Tribunal de Justiça de Sergipe',
  TJSP: 'Tribunal de Justiça de São Paulo',
  TJTO: 'Tribunal de Justiça do Tocantins',
};

function ordinal(value: number): string {
  return `${value}ª`;
}

export function inferTribunalTipo(codigo: string): TribunalTipo {
  if (codigo === 'STF') return 'STF';
  if (codigo === 'STJ') return 'STJ';
  if (codigo === 'TSE') return 'TSE';
  if (codigo === 'STM') return 'STM';
  if (codigo === 'TST' || codigo.startsWith('TRT')) return 'TRT';
  if (codigo.startsWith('TRF')) return 'TRF';
  return 'TJ';
}

export function nomeTribunal(codigo: string): string {
  if (TJ_NOMES[codigo]) return TJ_NOMES[codigo];
  if (codigo === 'STF') return 'Supremo Tribunal Federal';
  if (codigo === 'STJ') return 'Superior Tribunal de Justiça';
  if (codigo === 'TST') return 'Tribunal Superior do Trabalho';
  if (codigo === 'TSE') return 'Tribunal Superior Eleitoral';
  if (codigo === 'STM') return 'Superior Tribunal Militar';

  const trf = codigo.match(/^TRF(\d+)$/);
  if (trf) return `Tribunal Regional Federal da ${ordinal(Number(trf[1]))} Região`;

  const trt = codigo.match(/^TRT(\d+)$/);
  if (trt) return `Tribunal Regional do Trabalho da ${ordinal(Number(trt[1]))} Região`;

  return codigo;
}

export function listarTribunaisDataJud(): TribunalSeedConfig[] {
  return Object.entries(DATAJUD_TRIBUNAIS).map(([codigo, sigla]) => ({
    codigo,
    nome: nomeTribunal(codigo),
    baseUrl: `https://api-publica.datajud.cnj.jus.br/api_publica_${sigla}`,
    tipo: inferTribunalTipo(codigo),
    usaCaptcha: false,
    scraperConfig: {
      fonte: 'datajud-publica',
      sigla,
      esaj: codigo === 'TJSP',
    },
  }));
}
