import { DATAJUD_TRIBUNAIS } from './datajudSiglas';
import { inferTribunalTipo, nomeTribunal } from './datajudTribunais';

export type TribunalSourceKind =
  | 'datajud'
  | 'pje-public'
  | 'esaj'
  | 'eproc'
  | 'projudi'
  | 'mni'
  | 'court-specific';

export type TribunalAccessPolicy =
  | 'public'
  | 'captcha'
  | 'requires-login'
  | 'requires-certificate'
  | 'blocked';

export interface TribunalSourceStrategy {
  kind: TribunalSourceKind;
  policy: TribunalAccessPolicy;
  priority: number;
  urls: string[];
  description: string;
  positiveSample?: {
    oab: string;
    nome?: string;
    expectedMinProcesses: number;
    source: string;
  };
}

export interface TribunalSourceConfig {
  codigo: string;
  nome: string;
  tipo: ReturnType<typeof inferTribunalTipo>;
  datajudSigla: string;
  strategies: TribunalSourceStrategy[];
}

const TJ_UF: Record<string, string> = {
  TJAC: 'ac',
  TJAL: 'al',
  TJAM: 'am',
  TJAP: 'ap',
  TJBA: 'ba',
  TJCE: 'ce',
  TJDFT: 'df',
  TJES: 'es',
  TJGO: 'go',
  TJMA: 'ma',
  TJMG: 'mg',
  TJMS: 'ms',
  TJMT: 'mt',
  TJPA: 'pa',
  TJPB: 'pb',
  TJPE: 'pe',
  TJPI: 'pi',
  TJPR: 'pr',
  TJRJ: 'rj',
  TJRN: 'rn',
  TJRO: 'ro',
  TJRR: 'rr',
  TJRS: 'rs',
  TJSC: 'sc',
  TJSE: 'se',
  TJSP: 'sp',
  TJTO: 'to',
};

function dataJudStrategy(sigla: string): TribunalSourceStrategy {
  return {
    kind: 'datajud',
    policy: 'public',
    priority: 99,
    urls: [`https://api-publica.datajud.cnj.jus.br/api_publica_${sigla}/_search`],
    description: 'Fallback oficial CNJ para metadados e enriquecimento; nem sempre indexa OAB.',
  };
}

function pjeUrlsFor(codigo: string): string[] {
  // TJRJ não expõe PJe em pje.tjrj.jus.br (DNS inexistente); consulta pública fica em www3.
  if (codigo === 'TJRJ') {
    return [];
  }

  if (codigo === 'TJMG') {
    return [
      'https://pe.tjmg.jus.br/rupe/index.jsp',
      'https://pje.tjmg.jus.br/pje/ConsultaPublica/listView.seam',
      'https://pje.tjmg.jus.br/pje2g/ConsultaPublica/listView.seam',
    ];
  }

  const uf = TJ_UF[codigo];
  if (uf) {
    return [
      `https://pje.tj${uf}.jus.br/pje/ConsultaPublica/listView.seam`,
      `https://pje.tj${uf}.jus.br/pje2g/ConsultaPublica/listView.seam`,
    ];
  }

  const trt = codigo.match(/^TRT(\d+)$/);
  if (trt) {
    return [
      `https://pje.trt${trt[1]}.jus.br/consultaprocessual/`,
      `https://pje.trt${trt[1]}.jus.br/primeirograu/ConsultaPublica/listView.seam`,
      `https://pje.trt${trt[1]}.jus.br/segundograu/ConsultaPublica/listView.seam`,
    ];
  }

  const trf = codigo.match(/^TRF(\d+)$/);
  if (trf) {
    return [
      `https://pje${trf[1]}g.trf${trf[1]}.jus.br/pje/ConsultaPublica/listView.seam`,
      `https://pje.trf${trf[1]}.jus.br/pje/ConsultaPublica/listView.seam`,
    ];
  }

  return [];
}

function defaultStrategies(codigo: string, sigla: string): TribunalSourceStrategy[] {
  const strategies: TribunalSourceStrategy[] = [];
  const tipo = inferTribunalTipo(codigo);

  if (codigo === 'TJRJ') {
    strategies.push({
      kind: 'court-specific',
      policy: 'public',
      priority: 1,
      urls: [
        'https://www3.tjrj.jus.br/consultaprocessual/#/consultapublica#oab',
        'https://www3.tjrj.jus.br/consultaprocessual/',
      ],
      description:
        'Consulta processual pública do TJRJ (www3); exige comarca/competência no portal — integração dedicada pendente.',
    });
  }

  if (codigo === 'TJSP') {
    strategies.push({
      kind: 'esaj',
      policy: 'public',
      priority: 1,
      urls: ['https://esaj.tjsp.jus.br/cpopg/open.do', 'https://esaj.tjsp.jus.br/cposg/open.do'],
      description: 'Consulta e-SAJ pública por OAB com detalhe processual.',
      positiveSample: {
        oab: '361329',
        nome: 'Sidney da Silva',
        expectedMinProcesses: 1,
        source: 'validado-localmente',
      },
    });
  }

  const pjeUrls = pjeUrlsFor(codigo);
  if (pjeUrls.length > 0) {
    strategies.push({
      kind: 'pje-public',
      policy: codigo === 'TJMG' ? 'public' : 'captcha',
      priority: 2,
      urls: pjeUrls,
      description: 'Consulta pública PJe por OAB/nome quando exposta pelo tribunal.',
    });
  }

  if (['TRF4', 'TJRS', 'TJSC', 'TJTO'].includes(codigo)) {
    strategies.push({
      kind: 'eproc',
      policy: 'captcha',
      priority: 3,
      urls: [`https://eproc.${sigla}.jus.br`],
      description: 'Fonte eproc; exige configuração por tribunal e pode exigir captcha.',
    });
  }

  if (['TJPR', 'TJGO', 'TJBA', 'TJPE'].includes(codigo)) {
    strategies.push({
      kind: 'projudi',
      policy: 'requires-login',
      priority: 4,
      urls: [`https://projudi.${sigla}.jus.br`],
      description: 'Fonte Projudi quando existir; frequentemente exige credencial.',
    });
  }

  if (['STF', 'STJ', 'TST', 'TSE', 'STM'].includes(codigo) || codigo.startsWith('TRE') || codigo.startsWith('TJM')) {
    strategies.push({
      kind: 'court-specific',
      policy: tipo === 'STF' || tipo === 'TJM' ? 'captcha' : 'public',
      priority: 5,
      urls: [`https://www.${sigla}.jus.br`],
      description: 'Portal oficial exige integração específica por tribunal.',
    });
  }

  strategies.push(dataJudStrategy(sigla));
  return strategies.sort((a, b) => a.priority - b.priority);
}

export const TRIBUNAL_SOURCE_MATRIX: Record<string, TribunalSourceConfig> = Object.fromEntries(
  Object.entries(DATAJUD_TRIBUNAIS).map(([codigo, sigla]) => [
    codigo,
    {
      codigo,
      nome: nomeTribunal(codigo),
      tipo: inferTribunalTipo(codigo),
      datajudSigla: sigla,
      strategies: defaultStrategies(codigo, sigla),
    },
  ])
);

export function getTribunalSourceConfig(codigo: string): TribunalSourceConfig | undefined {
  return TRIBUNAL_SOURCE_MATRIX[codigo.toUpperCase()];
}

export function listarTribunalSourceMatrix(): TribunalSourceConfig[] {
  return Object.values(TRIBUNAL_SOURCE_MATRIX);
}
