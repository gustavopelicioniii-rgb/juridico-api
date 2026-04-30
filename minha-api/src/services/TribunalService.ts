/**
 * Serviço de Tribunal
 * Orquestra a busca de processos usando os adaptadores e salva no banco
 */

import { registry, DadosProcesso } from '../tribunais';
import Tribunal from '../models/Tribunal';
import Processo from '../models/Processo';
import Parte from '../models/Parte';
import Movimentacao from '../models/Movimentacao';
import Job from '../models/Job';
import OABBuscaCache from '../models/OABBuscaCache';
import { sequelize } from '../config/database';
import { Transaction, Op } from 'sequelize';
import logger from '../config/logger';
import oabCacheService from './OABCacheService';

const CACHE_TTL_MINUTES = 30;
const MAX_PARALLEL_FETCHES = 5; // Paralelo para produção
const ENRICHMENT_TIMEOUT_MS = 15000; // Timeout por processo (15s)

/**
 * Executa função com timeout
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, desc: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${desc} - timeout após ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

export interface ResultadoBuscaProcesso {
  processo: Processo;
  ehNovo: boolean;
  totalMovimentacoes: number;
  novasMovimentacoes: number;
}

class TribunalService {
  /**
   * Busca um processo pelo número e salva/atualiza no banco
   * Usa transação para garantir atomicidade em partes + movimentações
   */
  async buscarESalvarProcesso(
    numeroProcesso: string,
    tribunalCodigo: string,
    advogadoId?: string
  ): Promise<ResultadoBuscaProcesso> {
    const adapter = registry.get(tribunalCodigo);

    if (!adapter) {
      throw new Error(`Tribunal não suportado: ${tribunalCodigo}`);
    }

    logger.info(`Buscando processo ${numeroProcesso} no ${tribunalCodigo}`);

    const dadosProcesso = await adapter.buscarProcesso(numeroProcesso);

    const tribunal = await Tribunal.findOne({ where: { codigo: tribunalCodigo } });

    if (!tribunal) {
      throw new Error(`Tribunal não encontrado no banco: ${tribunalCodigo}`);
    }

    return sequelize.transaction(async (t: Transaction) => {
      const processoExistente = await Processo.findOne({
        where: { numeroProcesso: dadosProcesso.numeroProcesso },
        transaction: t,
      });

      const ehNovo = !processoExistente;
      let processo: Processo;

      if (ehNovo) {
        const createData: any = {
          numeroProcesso: dadosProcesso.numeroProcesso,
          tribunalId: tribunal.id,
          status: 'MONITORANDO',
          classe: dadosProcesso.classe,
          classeCodigo: dadosProcesso.classeCodigo,
          assunto: dadosProcesso.assunto,
          assuntoPrincipal: dadosProcesso.assuntoPrincipal,
          instancia: dadosProcesso.instancia || 'PRIMEIRA',
          primeiraInstancia: dadosProcesso.dataDistribuicao,
          dataAjuizamento: dadosProcesso.dataAjuizamento,
          valorCausa: dadosProcesso.valorCausa,
          orgaoJulgador: dadosProcesso.orgaoJulgador,
          orgaoJulgadorCodigo: dadosProcesso.orgaoJulgadorCodigo,
          nivelSigilo: dadosProcesso.nivelSigilo,
          sistema: dadosProcesso.sistema,
          formato: dadosProcesso.formato,
          ultimaMovimentacao:
            dadosProcesso.movimentacoes.length > 0
              ? dadosProcesso.movimentacoes[dadosProcesso.movimentacoes.length - 1].data
              : undefined,
          dadosOriginais: dadosProcesso.dadosOriginais,
          enriquecido: true,
        };
        if (advogadoId) {
          createData.advogadoId = advogadoId;
        }
        processo = await Processo.create(createData, { transaction: t });

        logger.info(`Novo processo criado: ${processo.numeroProcesso}`);
      } else {
        processo = processoExistente;
        await processo.update(
          {
            classe: dadosProcesso.classe || processo.classe,
            assunto: dadosProcesso.assunto || processo.assunto,
            assuntoPrincipal: dadosProcesso.assuntoPrincipal || processo.assuntoPrincipal,
            ultimaMovimentacao:
              dadosProcesso.movimentacoes.length > 0
                ? dadosProcesso.movimentacoes[dadosProcesso.movimentacoes.length - 1].data
                : processo.ultimaMovimentacao,
            valorCausa: dadosProcesso.valorCausa || processo.valorCausa,
            orgaoJulgador: dadosProcesso.orgaoJulgador || processo.orgaoJulgador,
            nivelSigilo: dadosProcesso.nivelSigilo ?? processo.nivelSigilo,
            dadosOriginais: dadosProcesso.dadosOriginais,
            enriquecido: true, // Marcado como enriquecido quando dados sao atualizados
          },
          { transaction: t }
        );

        logger.info(`Processo atualizado: ${processo.numeroProcesso}`);
      }

      // Salva/atualiza partes atomicamente
      await this.salvarPartes(processo.id, dadosProcesso.partes, t);

      // Salva movimentações atomicamente
      const resultadoMovimentacoes = await this.salvarMovimentacoes(
        processo.id,
        dadosProcesso.movimentacoes,
        t
      );

      return {
        processo,
        ehNovo,
        totalMovimentacoes: dadosProcesso.movimentacoes.length,
        novasMovimentacoes: resultadoMovimentacoes.novas,
      };
    });
  }

  /**
   * Salva partes do processo (dentro de transação)
   */
  private async salvarPartes(
    processoId: string,
    partes: DadosProcesso['partes'],
    t: Transaction
  ): Promise<void> {
    await Parte.destroy({ where: { processoId }, transaction: t });

    const partesData = partes.map(p => ({
      processoId,
      nome: p.nome,
      tipo: p.tipo,
      documento: p.documento,
      isAdvogado: p.isAdvogado,
    }));

    if (partesData.length > 0) {
      await Parte.bulkCreate(partesData, { transaction: t });
    }
  }

  /**
   * Salva movimentações (apenas as que ainda não existem, dentro de transação)
   */
  private async salvarMovimentacoes(
    processoId: string,
    movimentacoes: DadosProcesso['movimentacoes'],
    t: Transaction
  ): Promise<{ novas: number; total: number }> {
    const ultimaMovimentacao = await Movimentacao.findOne({
      where: { processoId },
      order: [['data', 'DESC']],
      transaction: t,
    });

    const dataUltimaRegistrada = ultimaMovimentacao?.data || new Date(0);

    const movimentacoesNovas = movimentacoes.filter(m => m.data > dataUltimaRegistrada);

    if (movimentacoesNovas.length === 0) {
      return { novas: 0, total: movimentacoes.length };
    }

    // Apenas movimentações dos últimos 30 dias são marcadas como "nova"
    // para evitar marcar todo o histórico como "novo" na primeira vez
    const dataLimiteNova = new Date();
    dataLimiteNova.setDate(dataLimiteNova.getDate() - 30);

    // Deduplica movimentações com mesma data + descrição dentro do mesmo scraping.
    // Isso evita inserir linhas duplicadas quando o tribunal retorna eventos repetidos.
    const chavesMovimentacoes = new Set<string>();
    const movimentacoesSemDuplicidade = movimentacoesNovas.filter((m) => {
      const chave = `${m.data.toISOString()}::${m.descricao.trim().toLowerCase()}`;
      if (chavesMovimentacoes.has(chave)) {
        return false;
      }
      chavesMovimentacoes.add(chave);
      return true;
    });

    const movimentacoesData = movimentacoesSemDuplicidade.map(m => ({
      processoId,
      descricao: m.descricao,
      data: m.data,
      origem: m.origem,
      dadosOriginais: m.dadosOriginais,
      nova: m.data >= dataLimiteNova,
    }));

    await Movimentacao.bulkCreate(movimentacoesData, { transaction: t });

    const totalNovasRecentes = movimentacoesData.filter(m => m.nova).length;
    const totalDuplicadasIgnoradas = movimentacoesNovas.length - movimentacoesSemDuplicidade.length;
    logger.info(
      `Salvas ${movimentacoesSemDuplicidade.length} movimentações para processo ${processoId} (${totalNovasRecentes} recentes, ${totalDuplicadasIgnoradas} duplicadas ignoradas)`
    );

    return { novas: movimentacoesSemDuplicidade.length, total: movimentacoes.length };
  }
  
  /**
   * Busca processos por OAB
   */
  async buscarPorOAB(
    oab: string,
    nome?: string,
    advogadoId?: string
  ): Promise<Processo[]> {
    const tribunais = registry.listar();
    const processosEncontrados: Processo[] = [];

    for (const { codigo } of tribunais) {
      const adapter = registry.get(codigo);
      if (!adapter) continue;

      try {
        const resultado = await adapter.buscarPorOAB(oab, nome);

        for (const proc of resultado.processos) {
          // Busca/salva cada processo encontrado
          try {
            const resultadoProcesso = await this.buscarESalvarProcesso(
              proc.numeroProcesso,
              codigo,
              advogadoId
            );
            processosEncontrados.push(resultadoProcesso.processo);
          } catch (error) {
            logger.warn(`Falha ao processar processo ${proc.numeroProcesso}: ${error}`);
          }
        }
      } catch (error) {
        logger.warn(`Falha ao buscar no tribunal ${codigo}: ${error}`);
      }
    }

    return processosEncontrados;
  }

  /**
   * Busca OAB com cache de dois níveis:
   * - L1 (memória): OABCacheService - instantâneo, mesmo processo
   * - L2 (banco): OABBuscaCache - persiste entre reinicializações
   *
   * Se a OAB foi buscada recentemente (dentro do TTL), retorna do cache L1.
   * Caso contrário, busca no tribunal e salva em ambos os caches.
   */
  async buscarPorOABComCache(
    oab: string,
    tribunalCodigo: string,
    nome?: string,
    advogadoId?: string,
    forceRefresh = false
  ): Promise<{ processos: Processo[]; doCache: boolean; tempoMs: number }> {
    const inicio = Date.now();
    const oabNormalizada = oab.toUpperCase().replace(/\s/g, '');

    // ===== L1: Cache em memória (verifica primeiro - mais rápido) =====
    if (!forceRefresh) {
      const entryL1 = oabCacheService.get(oabNormalizada, tribunalCodigo);
      if (entryL1) {
        logger.info(`[Cache OAB] L1 HIT para ${oabNormalizada} em ${tribunalCodigo}`);
        const numerosProcesso = entryL1.processos;
        const processos = await Processo.findAll({
          where: { numeroProcesso: numerosProcesso },
        });
        const tempoMs = Date.now() - inicio;
        return { processos, doCache: true, tempoMs };
      }
    }

    // ===== L2: Cache de banco (se L1 miss) =====
    if (!forceRefresh) {
      const cacheEntryL2 = await OABBuscaCache.findOne({
        where: {
          oab: oabNormalizada,
          tribunalCodigo,
          expiraEm: { [Op.gt]: new Date() },
        },
      });

      if (cacheEntryL2) {
        logger.info(`[Cache OAB] L2 HIT para ${oabNormalizada} em ${tribunalCodigo}`);
        const numerosProcesso = cacheEntryL2.resultadoJson.numerosProcessos as string[];

        // Popula L1 com dado do L2 para próximas consultas serem instantâneas
        oabCacheService.set(oabNormalizada, tribunalCodigo, numerosProcesso);

        const processos = await Processo.findAll({
          where: { numeroProcesso: numerosProcesso },
        });
        const tempoMs = Date.now() - inicio;
        return { processos, doCache: true, tempoMs };
      }
    }

    // ===== Cache miss - busca no tribunal =====
    logger.info(`[Cache OAB] MISS para ${oabNormalizada} em ${tribunalCodigo}, buscando no tribunal`);

    const adapter = registry.get(tribunalCodigo);
    if (!adapter) {
      throw new Error(`Tribunal nao suportado: ${tribunalCodigo}`);
    }

    const resultado = await adapter.buscarPorOAB(oabNormalizada, nome);
    const numerosProcessos: string[] = [];
    const enriquecidosComSucesso: string[] = [];

    // Adiciona TODOS os números ao cache
    for (const proc of resultado.processos) {
      numerosProcessos.push(proc.numeroProcesso);
    }

    logger.info(`[Cache OAB] ${resultado.processos.length} processos encontrados. Enriquecendo todos...`);

    // Busca e salva TODOS os processos em paralelo
    for (let i = 0; i < resultado.processos.length; i += MAX_PARALLEL_FETCHES) {
      const batch = resultado.processos.slice(i, i + MAX_PARALLEL_FETCHES);
      const results = await Promise.allSettled(
        batch.map(proc =>
          withTimeout(
            this.buscarESalvarProcesso(proc.numeroProcesso, tribunalCodigo, advogadoId)
              .then(() => proc.numeroProcesso),
            ENRICHMENT_TIMEOUT_MS,
            `Enriquecimento ${proc.numeroProcesso}`
          ).catch(error => {
            logger.warn(`Falha ao processar processo ${proc.numeroProcesso}: ${error}`);
            return null;
          })
        )
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) {
          enriquecidosComSucesso.push(r.value);
        }
      }
      logger.info(`[Cache OAB] Enriquecidos ${Math.min(i + MAX_PARALLEL_FETCHES, resultado.processos.length)}/${resultado.processos.length} processos`);
    }

    // Usa apenas os processos que foram realmente enriquecidos
    const numerosEnriquecidos = [...new Set(enriquecidosComSucesso)];
    const processosDoBanco = numerosEnriquecidos.length > 0
      ? await Processo.findAll({ where: { numeroProcesso: numerosEnriquecidos } })
      : [];

    // Salva nos dois níveis de cache
    const ttlMs = CACHE_TTL_MINUTES * 60 * 1000;

    // L1: Cache em memória
    oabCacheService.set(oabNormalizada, tribunalCodigo, numerosProcessos, ttlMs, nome);

    // L2: Cache no banco
    const expiraEm = new Date();
    expiraEm.setMinutes(expiraEm.getMinutes() + CACHE_TTL_MINUTES);

    await OABBuscaCache.upsert({
      oab: oabNormalizada,
      tribunalCodigo,
      resultadoJson: { numerosProcessos },
      totalProcessos: numerosProcessos.length,
      expiraEm,
    });

    const tempoMs = Date.now() - inicio;
    logger.info(`[Cache OAB] Busca completada para ${oabNormalizada}: ${numerosProcessos.length} processos (${numerosEnriquecidos.length} enriquecidos) em ${tempoMs}ms`);

    return { processos: processosDoBanco, doCache: false, tempoMs };
  }
  
  /**
   * Atualiza processo (busca dados mais recentes)
   */
  async atualizarProcesso(processoId: string): Promise<ResultadoBuscaProcesso> {
    const processo = await Processo.findByPk(processoId);
    
    if (!processo) {
      throw new Error(`Processo não encontrado: ${processoId}`);
    }
    
    // Busca tribunal associado
    const tribunal = await Tribunal.findByPk(processo.tribunalId);
    
    if (!tribunal || !tribunal.ativo) {
      throw new Error(`Tribunal não encontrado para o processo: ${processoId}`);
    }
    
    return this.buscarESalvarProcesso(
      processo.numeroProcesso,
      tribunal.codigo,
      processo.advogadoId !== '00000000-0000-0000-0000-000000000000' ? processo.advogadoId : undefined
    );
  }
  
  /**
   * Lista tribunais disponíveis
   */
  async listarTribunais(): Promise<Array<{ codigo: string; nome: string; tipo: string; ativo: boolean }>> {
    const tribunais = await Tribunal.findAll({ where: { ativo: true } });
    return tribunais.map(t => ({
      codigo: t.codigo,
      nome: t.nome,
      tipo: t.tipo,
      ativo: t.ativo,
    }));
  }
  
  /**
   * Cria job de scraping para um processo
   */
  async criarJobScraping(processoId: string, tipo: 'SCRAPE' | 'RETRY' = 'SCRAPE'): Promise<Job> {
    const processo = await Processo.findByPk(processoId);
    
    if (!processo) {
      throw new Error(`Processo não encontrado: ${processoId}`);
    }
    
    return Job.create({
      processoId,
      tipo,
      status: 'PENDENTE',
      payload: { numeroProcesso: processo.numeroProcesso },
      scheduledAt: new Date(),
      tentativas: 0,
      maxTentativas: 3,
    });
  }
  
  /**
   * Marca movimentações como visualizadas
   */
  async marcarMovimentacoesVisualizadas(processoId: string): Promise<number> {
    const [updated] = await Movimentacao.update(
      { nova: false },
      { where: { processoId, nova: true } }
    );
    
    return updated;
  }
}

export default new TribunalService();
