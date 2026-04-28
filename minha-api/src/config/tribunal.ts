export interface TribunalConfig {
  codigo: string;
  nome: string;
  baseUrl: string;
  tipo: 'TJ' | 'STJ' | 'STF' | 'TRT' | 'TRF';
  usaCaptcha: boolean;
  apiKey?: string;
  rateLimitRequests: number;
  rateLimitWindow: number; // in milliseconds
}

export const TRIBUNAIS: Record<string, TribunalConfig> = {
  TJSP: {
    codigo: 'TJSP',
    nome: 'Tribunal de Justiça de São Paulo',
    baseUrl: 'https://api.tjsp.jus.br',
    tipo: 'TJ',
    usaCaptcha: false,
    apiKey: process.env.TJSP_API_KEY,
    rateLimitRequests: 100,
    rateLimitWindow: 60000,
  },
  TJMG: {
    codigo: 'TJMG',
    nome: 'Tribunal de Justiça de Minas Gerais',
    baseUrl: 'https://www.tjmg.jus.br',
    tipo: 'TJ',
    usaCaptcha: true,
    rateLimitRequests: 10,
    rateLimitWindow: 60000,
  },
  STJ: {
    codigo: 'STJ',
    nome: 'Superior Tribunal de Justiça',
    baseUrl: 'https://www.stj.jus.br',
    tipo: 'STJ',
    usaCaptcha: false,
    rateLimitRequests: 20,
    rateLimitWindow: 60000,
  },
  STF: {
    codigo: 'STF',
    nome: 'Supremo Tribunal Federal',
    baseUrl: 'https://portal.stf.jus.br',
    tipo: 'STF',
    usaCaptcha: false,
    rateLimitRequests: 20,
    rateLimitWindow: 60000,
  },
  TST: {
    codigo: 'TST',
    nome: 'Tribunal Superior do Trabalho',
    baseUrl: 'https://www.tst.jus.br',
    tipo: 'TRT',
    usaCaptcha: false,
    rateLimitRequests: 20,
    rateLimitWindow: 60000,
  },
};

export const getTribunal = (codigo: string): TribunalConfig | undefined => {
  return TRIBUNAIS[codigo.toUpperCase()];
};

export const getTribunalAtivo = (): TribunalConfig[] => {
  return Object.values(TRIBUNAIS);
};
