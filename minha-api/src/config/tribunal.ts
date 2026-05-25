import { listarTribunaisDataJud, type TribunalTipo } from './datajudTribunais';

export interface TribunalConfig {
  codigo: string;
  nome: string;
  baseUrl: string;
  tipo: TribunalTipo;
  usaCaptcha: boolean;
  apiKey?: string;
  rateLimitRequests: number;
  rateLimitWindow: number; // in milliseconds
}

export const TRIBUNAIS: Record<string, TribunalConfig> = Object.fromEntries(
  listarTribunaisDataJud().map((tribunal) => [
    tribunal.codigo,
    {
      ...tribunal,
      apiKey: process.env.DATAJUD_API_KEY,
      rateLimitRequests: tribunal.codigo === 'TJSP' ? 100 : 20,
      rateLimitWindow: 60000,
    },
  ])
);

export const getTribunal = (codigo: string): TribunalConfig | undefined => {
  return TRIBUNAIS[codigo.toUpperCase()];
};

export const getTribunalAtivo = (): TribunalConfig[] => {
  return Object.values(TRIBUNAIS);
};
