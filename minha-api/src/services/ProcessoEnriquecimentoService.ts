/**
 * Serviço de Enriquecimento de Processos
 *
 * Orquestra a busca completa:
 * 1. DataJud (API pública CNJ) - busca rápida de processos por OAB
 * 2. ESAJ Crawler - complementa com partes, advogados e valor da causa
 * 3. PJe Crawler - backup para processos do PJe
 */

import { Op } from 'sequelize';
import { registry } from '../tribunais';
import esajCrawler from './ESAJCrawler';
import pjeCrawler from './PJeCrawler';
import { Processo, Parte } from '../models';
import logger from '../config/logger';

interface ProcessoEnriquecido {
  numeroProcesso: string;
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
 * Busca por OAB: combina DataJud (rápido) + enriquecimento crawler (detalhes ricos)
 */
async function buscarPorOABEnriquecido(
  oab: string,
  enriquecer = true
): Promise<ResultadoOAB> {
  const oabFormatada = oab.toUpperCase().replace(/\s/g, '');

  logger.info(`[Enriquecimento] Iniciando busca OAB ${oabFormatada}`);

  // 1. Buscar no DataJud via registry (usa TJSP por padrão para OAB SP)
  let numerosProcessos: string[] = [];

  try {
    const adapter = registry.get('TJSP');
    if (adapter) {
      const resultados = await adapter.buscarPorOAB(oabFormatada);
      numerosProcessos = resultados.processos.map((r: any) => r.numeroProcesso);
      logger.info(`[Enriquecimento] DataJud retornou ${numerosProcessos.length} processos`);
    }
  } catch (error: any) {
    logger.error(`[Enriquecimento] Erro DataJud: ${error.message}`);
  }

  // 2. Se não encontrou no DataJud, tentar crawlers diretamente
  if (numerosProcessos.length === 0) {
    logger.info(`[Enriquecimento] DataJud retornou vazio, tentando ESAJ crawler...`);

    const resultadoESAJ = await esajCrawler.buscarPorOAB(oabFormatada);
    if (resultadoESAJ.processos.length > 0) {
      numerosProcessos = resultadoESAJ.processos.map(p => p.numeroProcesso);
      logger.info(`[Enriquecimento] ESAJ retornou ${numerosProcessos.length} processos`);
    } else {
      const resultadoPJe = await pjeCrawler.buscarPorOAB(oabFormatada);
      if (resultadoPJe.processos.length > 0) {
        numerosProcessos = resultadoPJe.processos.map(p => p.numeroProcesso);
        logger.info(`[Enriquecimento] PJe retornou ${numerosProcessos.length} processos`);
      }
    }
  }

  if (numerosProcessos.length === 0) {
    return { processos: [], total: 0, novos: [], atualizados: [] };
  }

  // 3. Identificar processos novos vs já salvos no banco
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

  // 4. Enriquecer processos (crawler para partes, advogados, valor)
  const processosEnriquecidos: ProcessoEnriquecido[] = [];

  if (enriquecer) {
    const lote = 5;
    for (let i = 0; i < numerosProcessos.length; i += lote) {
      const batch = numerosProcessos.slice(i, i + lote);

      const enriched = await Promise.all(
        batch.map(async (numero) => {
          try {
            let dados: any = null;
            let fonte: 'datajud' | 'esaj' | 'pje' = 'esaj';

            // Tentar ESAJ primeiro (mais comum)
            dados = await esajCrawler.buscarDetalhesProcesso(numero);

            if (!dados || !dados.numeroProcesso) {
              dados = await pjeCrawler.buscarDetalhesProcesso(numero);
              fonte = 'pje';
            }

            if (!dados || !dados.numeroProcesso) {
              // Fallback: buscar apenas no DataJud
              const adapter = registry.get('TJSP');
              if (adapter) {
                dados = await adapter.buscarProcesso(numero);
              }
              fonte = 'datajud';
            }

            return {
              numeroProcesso: numero,
              dados: dados || {},
              fonte,
              enriquecido: fonte !== 'datajud',
            } as ProcessoEnriquecido;
          } catch (error: any) {
            logger.error(`[Enriquecimento] Erro ao enriquecer ${numero}: ${error.message}`);
            return {
              numeroProcesso: numero,
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
    const adapter = registry.get('TJSP');
    for (const numero of numerosProcessos) {
      try {
        if (adapter) {
          const dados = await adapter.buscarProcesso(numero);
          processosEnriquecidos.push({
            numeroProcesso: numero,
            dados: dados || {},
            fonte: 'datajud' as const,
            enriquecido: false,
          });
        }
      } catch { /* skip */ }
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
            }
          }
        }
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
