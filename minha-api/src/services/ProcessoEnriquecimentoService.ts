/**
 * Servico de Enriquecimento de Processos
 * Orquestra busca OAB via adaptadores e salvamento via TribunalService.
 */

import { Op } from 'sequelize';
import { registry } from '../tribunais';
import TribunalService from './TribunalService';
import Processo from '../models/Processo';
import logger from '../config/logger';
import { derivarTribunaisPorOAB } from '../utils/derivarTribunaisPorOAB';

const FALLBACK_TRIBUNAIS_OAB = ['TJSP', 'TJMG', 'STJ', 'STF'];

interface ProcessoEnriquecido {
  numeroProcesso: string;
  tribunalCodigo: string;
  dados: Record<string, unknown>;
  fonte: 'datajud';
  enriquecido: boolean;
}

interface ResultadoOAB {
  processos: ProcessoEnriquecido[];
  total: number;
  novos: string[];
  atualizados: string[];
}

async function buscarPorOABEnriquecido(
  oab: string,
  _enriquecer = true,
  nome?: string
): Promise<ResultadoOAB> {
  const oabFormatada = oab.toUpperCase().replace(/\s/g, '');
  const tribunaisDerivados = derivarTribunaisPorOAB(oabFormatada);
  const tribunais = tribunaisDerivados.length > 0
    ? tribunaisDerivados
    : FALLBACK_TRIBUNAIS_OAB.filter((codigo) => Boolean(registry.get(codigo)));

  if (tribunaisDerivados.length === 0) {
    logger.info('[Enriquecimento] OAB sem UF detectÃ¡vel; aplicando fallback de tribunais');
  }

  logger.info('[Enriquecimento] Busca OAB ' + oabFormatada + ' em ' + tribunais.length + ' tribunais');

  const numerosProcessos: string[] = [];
  const seenNumbers = new Set<string>();

  for (const tribunalCodigo of tribunais) {
    const adapter = registry.get(tribunalCodigo);
    if (!adapter) continue;

    try {
      const resultados = await adapter.buscarPorOAB(oabFormatada, nome);
      for (const proc of resultados.processos) {
        if (!seenNumbers.has(proc.numeroProcesso)) {
          seenNumbers.add(proc.numeroProcesso);
          numerosProcessos.push(proc.numeroProcesso);
        }
      }
    } catch (error) {
      logger.warn('[Enriquecimento] Erro ao buscar lista em ' + tribunalCodigo);
    }
  }

  if (numerosProcessos.length === 0) {
    return { processos: [], total: 0, novos: [], atualizados: [] };
  }

  const existente = await Processo.findAll({
    where: { numeroProcesso: { [Op.in]: numerosProcessos } },
    attributes: ['numeroProcesso'],
    raw: true,
  });

  const numerosExistentes = new Set(existente.map((p: any) => p.numeroProcesso));
  const numerosNovos = numerosProcessos.filter(n => !numerosExistentes.has(n));
  const numerosAtualizar = numerosProcessos.filter(n => numerosExistentes.has(n));

  const processosEnriquecidos: ProcessoEnriquecido[] = [];

  for (const numero of numerosProcessos) {
    for (const tribunalCodigo of tribunais) {
      const adapter = registry.get(tribunalCodigo);
      if (!adapter) continue;
      try {
        const dados = await adapter.buscarProcesso(numero);
        if (dados && dados.numeroProcesso) {
          processosEnriquecidos.push({
            numeroProcesso: numero,
            tribunalCodigo,
            dados: dados as unknown as Record<string, unknown>,
            fonte: 'datajud' as const,
            enriquecido: true,
          });
          break;
        }
      } catch (error) {
        logger.warn('[Enriquecimento] Erro ao enriquecer ' + numero + ' em ' + tribunalCodigo);
      }
    }
  }

  logger.info('[Enriquecimento] OAB ' + oabFormatada + ': ' + processosEnriquecidos.length + ' processos enriquecidos (' + numerosNovos.length + ' novos, ' + numerosAtualizar.length + ' existentes)');

  return {
    processos: processosEnriquecidos,
    total: processosEnriquecidos.length,
    novos: numerosNovos,
    atualizados: numerosAtualizar,
  };
}

async function salvarLoteProcessos(
  processos: ProcessoEnriquecido[],
  advogadoId?: string
): Promise<{ salvos: number; erros: number }> {
  let salvos = 0;
  let erros = 0;

  for (const processo of processos) {
    try {
      await TribunalService.buscarESalvarProcesso(
        processo.numeroProcesso,
        processo.tribunalCodigo,
        advogadoId
      );
      salvos++;
    } catch (error) {
      logger.error('[Enriquecimento] Erro ao salvar ' + processo.numeroProcesso);
      erros++;
    }
  }

  return { salvos, erros };
}

async function salvarProcessoEnriquecido(
  processo: ProcessoEnriquecido,
  advogadoId?: string
): Promise<{ sucesso: boolean; erro?: string }> {
  try {
    await TribunalService.buscarESalvarProcesso(
      processo.numeroProcesso,
      processo.tribunalCodigo,
      advogadoId
    );
    return { sucesso: true };
  } catch (error: any) {
    logger.error('[Enriquecimento] Erro ao salvar ' + processo.numeroProcesso);
    return { sucesso: false, erro: error.message };
  }
}

export { buscarPorOABEnriquecido, salvarLoteProcessos, salvarProcessoEnriquecido };
export type { ProcessoEnriquecido, ResultadoOAB };
