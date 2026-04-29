/**
 * Servico de Enriquecimento de Processos
 * Usa TribunalService (adaptadores DataJud) para buscar e salvar processos.
 */

import { Op } from 'sequelize';
import { registry } from '../tribunais';
import TribunalService from './TribunalService';
import Processo from '../models/Processo';
import Parte from '../models/Parte';
import Movimentacao from '../models/Movimentacao';
import logger from '../config/logger';

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

function derivarTribunaisPorOAB(oab: string): string[] {
  const uf = oab.replace(/\d/g, '').toUpperCase().trim();
  const ufMap: Record<string, string[]> = {
    SP: ['TJSP'], MG: ['TJMG'], RJ: ['TJRJ'], RS: ['TJRS'],
    PR: ['TJPR'], SC: ['TJSC'], BA: ['TJBA'], CE: ['TJCE'],
    PE: ['TJPE'], PA: ['TJPA'], MA: ['TJMA'], GO: ['TJGO'],
    '2': ['TRT2'], '3': ['TRT3'], '4': ['TRT4'], '6': ['TRT6'],
    '8': ['TRT8'], '9': ['TRT9'], '10': ['TRT10'], '11': ['TRT11'],
    '12': ['TRT12'], '13': ['TRT13'], '14': ['TRT14'], '15': ['TRT15'],
    '16': ['TRT16'], '17': ['TRT17'], '18': ['TRT18'], '19': ['TRT19'],
    '20': ['TRT20'], '21': ['TRT21'], '22': ['TRT22'], '23': ['TRT23'],
    '24': ['TRT24'], '1': ['TRT1'],
  };
  return ufMap[uf] || ['TJSP', 'TJMG', 'STJ', 'STF'];
}

async function buscarPorOABEnriquecido(
  oab: string,
  _enriquecer = true,
  nome?: string
): Promise<ResultadoOAB> {
  const oabFormatada = oab.toUpperCase().replace(/\s/g, '');
  const tribunais = derivarTribunaisPorOAB(oabFormatada);

  logger.info(`[Enriquecimento] Busca OAB ${oabFormatada} em ${tribunais.length} tribunais`);

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
      logger.warn(`[Enriquecimento] Erro em ${tribunalCodigo}`);
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
            fonte: 'datajud',
            enriquecido: false,
          });
          break;
        }
      } catch { /* continua */ }
    }
  }

  return {
    processos: processosEnriquecidos,
    total: processosEnriquecidos.length,
    novos: numerosNovos,
    atualizados: numerosAtualizar,
  };
}

async function salvarLoteProcessos(
  processos: ProcessoEnriquecido[]
): Promise<{ salvos: number; erros: number }> {
  let salvos = 0;
  let erros = 0;

  for (const processo of processos) {
    try {
      await TribunalService.buscarESalvarProcesso(
        processo.numeroProcesso,
        processo.tribunalCodigo
      );
      salvos++;
    } catch (error) {
      logger.error(`[Enriquecimento] Erro ao salvar ${processo.numeroProcesso}`);
      erros++;
    }
  }

  return { salvos, erros };
}

export { buscarPorOABEnriquecido, salvarLoteProcessos };
export type { ProcessoEnriquecido, ResultadoOAB };
