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
  partes?: Array<{
    nome: string;
    tipo?: string;
    documento?: string | null;
    isAdvogado?: boolean;
  }>;
  advogados?: Array<{
    nome: string;
    numeroOAB?: string;
    ufOAB?: string;
    tipo?: string;
  }>;
  movimentacoes?: Array<{
    data: string;
    descricao: string;
    origem?: string;
    codigoMovimento?: number;
  }>;
}

export function normalizarNumeroProcesso(value: string): string {
  const trimmed = String(value || '').trim();
  const onlyDigits = trimmed.replace(/\D/g, '');
  return onlyDigits || trimmed;
}

function toIsoDate(value?: Date | string | null): string | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

export function serializeProcessoModel(
  processo: Processo,
  tribunalCodigo: string,
  resumo?: OABProcessoResumo
): ProcessoApiResponse {
  const partes = (processo.get('partes') as Array<{
    nome: string;
    tipo?: string;
    documento?: string | null;
    isAdvogado?: boolean;
  }> | undefined) ?? [];
  const movimentacoes = (processo.get('movimentacoes') as Array<{
    data: Date | string;
    descricao: string;
    origem?: string;
    codigoMovimento?: number;
  }> | undefined) ?? [];
  const resumoPartes = resumo?.partes ?? [];
  const partesFinal = partes.length > 0 ? partes : resumoPartes;
  const advogadosDasPartes = partesFinal
    .filter((parte) => parte.isAdvogado === true || parte.tipo === 'ADVOGADO')
    .map((parte) => {
      const [numeroOAB, ufOAB] = String(parte.documento ?? '').split('/');
      return {
        nome: parte.nome,
        numeroOAB: numeroOAB || undefined,
        ufOAB: ufOAB || undefined,
        tipo: 'ADVOGADO',
      };
    });
  const advogadosFinal = advogadosDasPartes.length > 0 ? advogadosDasPartes : (resumo?.advogados ?? []);
  const movimentacoesFinal = movimentacoes.length > 0
    ? movimentacoes
    : (resumo?.movimentacoes ?? []);

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
    partes: partesFinal.map((parte) => ({
      nome: parte.nome,
      tipo: parte.tipo,
      documento: parte.documento ?? null,
      isAdvogado: parte.isAdvogado,
    })),
    advogados: advogadosFinal,
    movimentacoes: movimentacoesFinal
      .map((mov) => ({
        data: toIsoDate(mov.data) ?? '',
        descricao: mov.descricao,
        origem: mov.origem,
        codigoMovimento: mov.codigoMovimento,
      }))
      .filter((mov) => mov.data && mov.descricao),
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
    partes: resumo.partes ?? [],
    advogados: resumo.advogados ?? [],
    movimentacoes: (resumo.movimentacoes ?? [])
      .map((mov) => ({
        data: toIsoDate(mov.data) ?? '',
        descricao: mov.descricao,
        origem: mov.origem,
        codigoMovimento: mov.codigoMovimento,
      }))
      .filter((mov) => mov.data && mov.descricao),
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

  const numerosNormalizados = Array.from(new Set(numerosProcesso.map(normalizarNumeroProcesso)));
  const dbRows = await findProcessos(numerosNormalizados);
  const dbMap = new Map(dbRows.map(row => [normalizarNumeroProcesso(row.numeroProcesso), row]));
  const resumoMap = new Map(resumo.map(item => [normalizarNumeroProcesso(item.numeroProcesso), item]));

  return numerosNormalizados.flatMap(numero => {
    const db = dbMap.get(numero);
    const item = resumoMap.get(numero);
    if (db) return serializeProcessoModel(db, tribunalCodigo, item);
    if (item) return serializeResumoOab(item, tribunalCodigo);
    return [];
  });
}
