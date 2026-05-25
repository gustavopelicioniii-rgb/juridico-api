import Processo from '../models/Processo';
import type { ResultadoBusca } from '../tribunais';

export type OABProcessoResumo = ResultadoBusca['processos'][number];

export interface ProcessoApiResponse {
  id?: string;
  numeroProcesso: string;
  classe?: string | null;
  assunto?: string | null;
  assuntoPrincipal?: string | null;
  orgaoJulgador?: string | null;
  dataAjuizamento?: string | null;
  ultimaMovimentacao?: string | null;
  valorCausa?: number | null;
  status?: string;
  instancia?: string;
  formato?: string | null;
  sistema?: string | null;
  enriquecido?: boolean;
  tribunal?: { codigo: string; nome?: string } | null;
}

function toIsoDate(value?: Date | string | null): string | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

export function serializeProcessoModel(
  processo: Processo,
  tribunalCodigo: string
): ProcessoApiResponse {
  return {
    id: processo.id,
    numeroProcesso: processo.numeroProcesso,
    classe: processo.classe ?? null,
    assunto: processo.assunto ?? null,
    assuntoPrincipal: processo.assuntoPrincipal ?? null,
    orgaoJulgador: processo.orgaoJulgador ?? null,
    dataAjuizamento: toIsoDate(processo.dataAjuizamento) ?? null,
    ultimaMovimentacao: toIsoDate(processo.ultimaMovimentacao) ?? null,
    valorCausa: processo.valorCausa != null ? Number(processo.valorCausa) : null,
    status: processo.status,
    instancia: processo.instancia,
    formato: processo.formato ?? null,
    sistema: processo.sistema ?? null,
    enriquecido: processo.enriquecido ?? false,
    tribunal: { codigo: tribunalCodigo },
  };
}

export function serializeResumoOab(
  resumo: OABProcessoResumo,
  tribunalCodigo: string
): ProcessoApiResponse {
  const codigo = (resumo.tribunalCodigo || tribunalCodigo).toUpperCase();
  return {
    numeroProcesso: resumo.numeroProcesso,
    classe: resumo.classe ?? null,
    assunto: resumo.assunto ?? null,
    assuntoPrincipal: resumo.assunto ?? null,
    orgaoJulgador: resumo.orgaoJulgador ?? null,
    dataAjuizamento: resumo.dataAjuizamento ? String(resumo.dataAjuizamento) : null,
    valorCausa: resumo.valorCausa ?? null,
    status: 'MONITORANDO',
    enriquecido: false,
    tribunal: { codigo },
  };
}

export function extrairResumoCache(resultadoJson: Record<string, unknown>): OABProcessoResumo[] {
  const raw = resultadoJson.resumo;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is OABProcessoResumo =>
      typeof item === 'object' &&
      item != null &&
      typeof (item as OABProcessoResumo).numeroProcesso === 'string'
  );
}

export async function montarProcessosParaApi(
  numerosProcesso: string[],
  tribunalCodigo: string,
  resumo: OABProcessoResumo[],
  findProcessos: (numeros: string[]) => Promise<Processo[]>
): Promise<ProcessoApiResponse[]> {
  if (numerosProcesso.length === 0) return [];

  const dbRows = await findProcessos(numerosProcesso);
  const dbMap = new Map(dbRows.map(row => [row.numeroProcesso, row]));
  const resumoMap = new Map(resumo.map(item => [item.numeroProcesso, item]));

  return numerosProcesso.map(numero => {
    const db = dbMap.get(numero);
    if (db) return serializeProcessoModel(db, tribunalCodigo);
    const item = resumoMap.get(numero);
    return serializeResumoOab(
      item ?? { numeroProcesso: numero, tribunalCodigo },
      tribunalCodigo
    );
  });
}
