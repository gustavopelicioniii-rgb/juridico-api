/**
 * Serviço de Enriquecimento de Processos
 *
 * Orquestra a busca completa:
 * 1. DataJud (API pública CNJ) - busca rápida de processos por OAB
 * 2. ESAJ Crawler - complementa com partes, advogados e valor da causa
 * 3. PJe Crawler - backup para processos do PJe
 *
 * AGORA SUPORTA MÚLTIPLOS TRIBUNAIS - cada tribunal usa seu crawler específico
 */

import { Op } from 'sequelize';
import { registry } from '../tribunais';
import { ESAJCrawler } from './ESAJCrawler';
import { PJeCrawler } from './PJeCrawler';
import { Processo, Parte, Movimentacao } from '../models';
import logger from '../config/logger';
import { derivarTribunaisPorOAB, getTribunaisParaBusca } from './TribunalDerivacaoService';
import { getCrawlerConfig } from '../config/tribunalCrawlers';

interface ProcessoEnriquecido {
  numeroProcesso: string;
  tribunalCodigo: string;
  dados: any;
  fonte: 'datajud' | 'esaj' | 'pje';
  enriquecido: boolean;
}

interface ResultadoOAB {
  processos: ProcessoEnriquecido[];
  total: number;
  novos: string[];
  atualizados: string[];
}

/**
 * Obtém o crawler correto baseado no código do tribunal
 */
function getCrawlerForTribunal(tribunalCodigo: string): { esaj?: ESAJCrawler; pje?: PJeCrawler } {
  const config = getCrawlerConfig(tribunalCodigo);
  
  if (!config) {
    // Fallback para TJSP se não houver configuração
    return { esaj: ESAJCrawler.forTribunal('TJSP'), pje: PJeCrawler.forTribunal('TJSP') };
  }

  if (config.tipo === 'ESAJ') {
    return { esaj: ESAJCrawler.forTribunal(tribunalCodigo) };
  }

  if (config.tipo === 'PJE') {
    return { pje: PJeCrawler.forTribunal(tribunalCodigo) };
  }

  // OTHER ou desconhecido - tenta ambos como fallback
  return { esaj: ESAJCrawler.forTribunal(tribunalCodigo), pje: PJeCrawler.forTribunal(tribunalCodigo) };
}

/**
 * Busca crawler para enriquecimento de detalhes
 */
async function buscarDetalhesDoProcesso(
  numeroProcesso: string,
  tribunais: string[]
): Promise<{ dados: any; fonte: 'datajud' | 'esaj' | 'pje'; tribunalCodigo: string }> {
  // 1. Tentar crawlers ESAJ/PJe para cada tribunal
  for (const tribunalCodigo of tribunais) {
    const crawlers = getCrawlerForTribunal(tribunalCodigo);

    if (crawlers.esaj) {
      const dados = await crawlers.esaj.buscarDetalhesProcesso(numeroProcesso);
      if (dados && dados.numeroProcesso) {
        return { dados, fonte: 'esaj', tribunalCodigo };
      }
    }

    if (crawlers.pje) {
      const dados = await crawlers.pje.buscarDetalhesProcesso(numeroProcesso);
      if (dados && dados.numeroProcesso) {
        return { dados, fonte: 'pje', tribunalCodigo };
      }
    }
  }

  // 2. Fallback: tentar DataJud em cada tribunal derivado
  for (const tribunalCodigo of tribunais) {
    try {
      const adapter = registry.get(tribunalCodigo);
      if (adapter) {
        const dados = await adapter.buscarProcesso(numeroProcesso);
        if (dados && dados.numeroProcesso) {
          return { dados, fonte: 'datajud', tribunalCodigo };
        }
      }
    } catch { /* continua para próximo */ }
  }

  return { dados: null, fonte: 'datajud', tribunalCodigo: tribunais[0] || 'UNKNOWN' };
}

/**
 * Busca por OAB: combina DataJud (rápido) + enriquecimento crawler (detalhes ricos)
 * Deriva automaticamente os tribunais pela UF da OAB
 * Suporta filtro por nome do advogado para evitar resultados de OABs compartilhadas
 */
async function buscarPorOABEnriquecido(
  oab: string,
  enriquecer = true,
  nome?: string
): Promise<ResultadoOAB> {
  const oabFormatada = oab.toUpperCase().replace(/\s/g, '');

  logger.info(`[Enriquecimento] Iniciando busca OAB ${oabFormatada}${nome ? ` + nome "${nome}"` : ''}`);

  // 1. Derivar tribunais pela UF da OAB
  const derivacao = derivarTribunaisPorOAB(oabFormatada);
  const tribunais = derivacao 
    ? derivacao.tribunais.map(t => t.codigo)
    : registry.listar().map(t => t.codigo);

  logger.info(`[Enriquecimento] Buscando em ${tribunais.length} tribunais: ${tribunais.join(', ')}`);

  // 2. Buscar no DataJud em cada tribunal derivado
  let numerosProcessos: string[] = [];
  const seenNumbers = new Set<string>();

  for (const tribunalCodigo of tribunais) {
    try {
      const adapter = registry.get(tribunalCodigo);
      if (!adapter) continue;

      const resultados = await adapter.buscarPorOAB(oabFormatada, nome);
      
      for (const proc of resultados.processos) {
        if (!seenNumbers.has(proc.numeroProcesso)) {
          seenNumbers.add(proc.numeroProcesso);
          numerosProcessos.push(proc.numeroProcesso);
        }
      }
      
      logger.info(`[Enriquecimento] ${tribunalCodigo}: ${resultados.total} processos`);
    } catch (error: any) {
      logger.warn(`[Enriquecimento] Erro em ${tribunalCodigo}: ${error.message}`);
    }
  }

  logger.info(`[Enriquecimento] Total único: ${numerosProcessos.length} processos`);

  // 3. Se não encontrou no DataJud, tentar crawlers ESAJ/PJe para cada tribunal derivado
  if (numerosProcessos.length === 0) {
    logger.info(`[Enriquecimento] DataJud retornou vazio, tentando crawlers...`);

    for (const tribunalCodigo of tribunais) {
      const crawlers = getCrawlerForTribunal(tribunalCodigo);

      if (crawlers.esaj) {
        const resultadoESAJ = await crawlers.esaj.buscarPorOAB(oabFormatada, nome);
        if (resultadoESAJ.processos.length > 0) {
          numerosProcessos = resultadoESAJ.processos.map(p => p.numeroProcesso);
          logger.info(`[Enriquecimento] ESAJ [${tribunalCodigo}] retornou ${numerosProcessos.length} processos`);
          break;
        }
      }

      if (crawlers.pje) {
        const resultadoPJe = await crawlers.pje.buscarPorOAB(oabFormatada, nome);
        if (resultadoPJe.processos.length > 0) {
          numerosProcessos = resultadoPJe.processos.map(p => p.numeroProcesso);
          logger.info(`[Enriquecimento] PJe [${tribunalCodigo}] retornou ${numerosProcessos.length} processos`);
          break;
        }
      }
    }
  }

  if (numerosProcessos.length === 0) {
    return { processos: [], total: 0, novos: [], atualizados: [] };
  }

  // 4. Identificar processos novos vs já salvos no banco
  const existente = await Processo.findAll({
    where: { numeroProcesso: { [Op.in]: numerosProcessos } },
    attributes: ['numeroProcesso'],
    raw: true,
  });

  const numerosExistentes = new Set(existente.map((p: any) => p.numeroProcesso));
  const numerosNovos = numerosProcessos.filter(n => !numerosExistentes.has(n));
  const numerosAtualizar = numerosProcessos.filter(n => numerosExistentes.has(n));

  logger.info(
    `[Enriquecimento] Já existem ${numerosAtualizar.length} processos, ${numerosNovos.length} são novos`
  );

  // 5. Enriquecer processos (crawler para partes, advogados, valor)
  const processosEnriquecidos: ProcessoEnriquecido[] = [];

  if (enriquecer) {
    const lote = 5;
    for (let i = 0; i < numerosProcessos.length; i += lote) {
      const batch = numerosProcessos.slice(i, i + lote);

      const enriched = await Promise.all(
        batch.map(async (numero) => {
          try {
            const { dados, fonte, tribunalCodigo } = await buscarDetalhesDoProcesso(numero, tribunais);

            return {
              numeroProcesso: numero,
              tribunalCodigo,
              dados: dados || {},
              fonte,
              enriquecido: fonte !== 'datajud',
            } as ProcessoEnriquecido;
          } catch (error: any) {
            logger.error(`[Enriquecimento] Erro ao enriquecer ${numero}: ${error.message}`);
            return {
              numeroProcesso: numero,
              tribunalCodigo: tribunais[0] || 'UNKNOWN',
              dados: {},
              fonte: 'datajud' as const,
              enriquecido: false,
            };
          }
        })
      );

      processosEnriquecidos.push(...enriched);

      if (i + lote < numerosProcessos.length) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  } else {
    // Sem enriquecimento: busca apenas no DataJud para tribunais derivados
    for (const numero of numerosProcessos) {
      for (const tribunalCodigo of tribunais) {
        try {
          const adapter = registry.get(tribunalCodigo);
          if (adapter) {
            const dados = await adapter.buscarProcesso(numero);
            if (dados && dados.numeroProcesso) {
              processosEnriquecidos.push({
                numeroProcesso: numero,
                tribunalCodigo,
                dados: dados || {},
                fonte: 'datajud' as const,
                enriquecido: false,
              });
              break; // Encontrou, não precisa tentar outro tribunal
            }
          }
        } catch { /* continua para próximo tribunal */ }
      }
    }
  }

  return {
    processos: processosEnriquecidos,
    total: processosEnriquecidos.length,
    novos: numerosNovos,
    atualizados: numerosAtualizar,
  };
}

/**
 * Salva processo enriquecido no banco
 */
async function salvarProcessoEnriquecido(
  processo: ProcessoEnriquecido
): Promise<void> {
  const { numeroProcesso, dados, enriquecido } = processo;

  const [proc, created] = await Processo.findOrCreate({
    where: { numeroProcesso },
    defaults: {
      numeroProcesso,
      dadosOriginais: dados.dados || dados,
      classe: dados.classe || dados.classeNome || null,
      classeCodigo: dados.classeCodigo || null,
      assuntoPrincipal: dados.assuntoPrincipal || dados.assunto || null,
      dataAjuizamento: dados.dataAjuizamento
        ? new Date(dados.dataAjuizamento)
        : undefined,
      valorCausa: dados.valorCausa || null,
      orgaoJulgador: dados.orgaoJulgador || dados.orgao || null,
      orgaoJulgadorCodigo: dados.orgaoJulgadorCodigo || null,
      nivelSigilo: dados.nivelSigilo || 0,
      sistema: dados.sistema || null,
      formato: dados.formato || null,
      enriquecido,
      ultimaMovimentacao: dados.ultimaMovimentacao
        ? new Date(dados.ultimaMovimentacao)
        : undefined,
    },
  });

  if (!created) {
    await proc.update({
      dadosOriginais: dados.dados || dados,
      classe: dados.classe || dados.classeNome || proc.classe,
      classeCodigo: dados.classeCodigo || proc.classeCodigo,
      assuntoPrincipal: dados.assuntoPrincipal || dados.assunto || proc.assuntoPrincipal,
      dataAjuizamento: dados.dataAjuizamento
        ? new Date(dados.dataAjuizamento)
        : proc.dataAjuizamento,
      valorCausa: dados.valorCausa || proc.valorCausa,
      orgaoJulgador: dados.orgaoJulgador || dados.orgao || proc.orgaoJulgador,
      enriquecido: enriquecido || proc.enriquecido,
      ultimaMovimentacao: dados.ultimaMovimentacao
        ? new Date(dados.ultimaMovimentacao)
        : proc.ultimaMovimentacao,
    });
  }

  // Salvar partes (busca processo pelo número para obter ID)
  if (dados.partes && dados.partes.length > 0) {
    const procInstance = await Processo.findOne({
      where: { numeroProcesso },
      attributes: ['id'],
      raw: true,
    });

    if (procInstance) {
      for (const parte of dados.partes) {
        const [parteModel] = await Parte.findOrCreate({
          where: { processoId: procInstance.id, nome: parte.nome },
          defaults: {
            processoId: procInstance.id,
            tipo: (parte.tipo as any) || 'OUTRO',
            nome: parte.nome,
            documento: parte.documento || null,
            isAdvogado: parte.tipo === 'ADVOGADO',
          },
        });

        if (parte.advogados && parte.advogados.length > 0) {
          for (const adv of parte.advogados) {
            if (typeof adv === 'string') {
              await Parte.findOrCreate({
                where: { processoId: procInstance.id, nome: adv },
                defaults: {
                  processoId: procInstance.id,
                  tipo: 'ADVOGADO' as any,
                  nome: adv,
                  isAdvogado: true,
                },
              });
            } else if (adv && adv.nome) {
              await Parte.findOrCreate({
                where: { processoId: procInstance.id, nome: adv.nome },
                defaults: {
                  processoId: procInstance.id,
                  tipo: 'ADVOGADO' as any,
                  nome: adv.nome,
                  isAdvogado: true,
                },
              });
            }
          }
        }
      }
    }
  }

  // Salvar movimentações
  if (dados.movimentacoes && dados.movimentacoes.length > 0) {
    const procInstance = await Processo.findOne({
      where: { numeroProcesso },
      attributes: ['id'],
      raw: true,
    });

    if (procInstance) {
      for (const mov of dados.movimentacoes) {
        const movData = mov.data instanceof Date ? mov.data : new Date(mov.data);
        if (isNaN(movData.getTime())) continue;

        const [movModel] = await Movimentacao.findOrCreate({
          where: {
            processoId: procInstance.id,
            data: movData,
            descricao: mov.descricao,
          },
          defaults: {
            processoId: procInstance.id,
            descricao: mov.descricao,
            data: movData,
            origem: mov.origem || null,
            dadosOriginais: mov.dadosOriginais || {},
            nova: false,
          },
        });
      }
    }
  }
}

/**
 * Salva múltiplos processos em lote
 */
async function salvarLoteProcessos(processos: ProcessoEnriquecido[]): Promise<{
  salvos: number;
  erros: number;
}> {
  let salvos = 0;
  let erros = 0;

  for (const processo of processos) {
    try {
      await salvarProcessoEnriquecido(processo);
      salvos++;
    } catch (error: any) {
      logger.error(`[Enriquecimento] Erro ao salvar ${processo.numeroProcesso}: ${error.message}`);
      erros++;
    }
  }

  return { salvos, erros };
}

export {
  buscarPorOABEnriquecido,
  salvarProcessoEnriquecido,
  salvarLoteProcessos,
};
export type { ProcessoEnriquecido, ResultadoOAB };
