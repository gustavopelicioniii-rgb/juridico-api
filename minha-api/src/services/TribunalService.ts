/**
 * Serviço de Tribunal
 * Orquestra a busca de processos usando os adaptadores e salva no banco
 */

import { registry, DadosProcesso, ResultadoBusca } from '../tribunais';
import Tribunal from '../models/Tribunal';
import Processo from '../models/Processo';
import Parte from '../models/Parte';
import Movimentacao from '../models/Movimentacao';
import Monitoramento from '../models/Monitoramento';
import Job from '../models/Job';
import OABBuscaCache from '../models/OABBuscaCache';
import { sequelize } from '../config/database';
import { Transaction, Op } from 'sequelize';
import logger from '../config/logger';
import oabCacheService from './OABCacheService';
import { DEFAULT_PROCESS_MONITORING_INTERVAL_MINUTES } from '../config/monitoring';
import {
  extrairResumoCache,
  montarProcessosParaApi,
  normalizarNumeroProcesso,
  type OABProcessoResumo,
  type ProcessoApiResponse,
} from '../utils/serializeProcessoApi';

const CACHE_TTL_MINUTES = 30;
const MAX_PARALLEL_FETCHES = 5; // Paralelo para produção
const ENRICHMENT_TIMEOUT_MS = 45000; // Crawlers públicos podem oscilar por processo
const UF_PREFIX_REGEX = /^(AC|AL|AM|AP|BA|CE|DF|ES|GO|MA|MG|MS|MT|PA|PB|PE|PI|PR|RJ|RN|RO|RR|RS|SC|SE|SP|TO)/;

type ProcessoPersistData = {
  numeroProcesso: string;
  tribunalId: string;
  advogadoId?: string;
  status: 'MONITORANDO';
  classe?: string;
  classeCodigo?: number;
  assunto?: string;
  assuntoPrincipal?: string;
  instancia: 'PRIMEIRA' | 'SEGUNDA' | 'SUPERIOR';
  primeiraInstancia?: Date;
  dataAjuizamento?: Date;
  valorCausa?: number;
  orgaoJulgador?: string;
  orgaoJulgadorCodigo?: number;
  nivelSigilo?: number;
  sistema?: string;
  formato?: string;
  ultimaMovimentacao?: Date;
  dadosOriginais: Record<string, unknown>;
  enriquecido: boolean;
};

type ProcessoUpdateData = Partial<Omit<ProcessoPersistData, 'numeroProcesso' | 'tribunalId' | 'status' | 'instancia'>> & {
  advogadoId?: string;
  enriquecido: boolean;
};

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

function validDate(value?: Date | null): Date | undefined {
  if (!value || Number.isNaN(value.getTime())) return undefined;
  return value;
}

function ultimaDataValida(movimentacoes: DadosProcesso['movimentacoes']): Date | undefined {
  for (let i = movimentacoes.length - 1; i >= 0; i--) {
    const data = validDate(movimentacoes[i].data);
    if (data) return data;
  }
  return undefined;
}

function valorInteiro(value?: number): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  return Math.round(value);
}

function dataValida(value?: Date | string): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function limitarTexto(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function buildOABCacheKeys(oabNormalizada: string): string[] {
  const semUf = oabNormalizada.replace(UF_PREFIX_REGEX, '');
  return Array.from(new Set([oabNormalizada, semUf].filter(Boolean)));
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
        const createData: ProcessoPersistData = {
          numeroProcesso: dadosProcesso.numeroProcesso,
          tribunalId: tribunal.id,
          status: 'MONITORANDO',
          classe: dadosProcesso.classe,
          classeCodigo: dadosProcesso.classeCodigo,
          assunto: dadosProcesso.assunto,
          assuntoPrincipal: dadosProcesso.assuntoPrincipal,
          instancia: dadosProcesso.instancia || 'PRIMEIRA',
          primeiraInstancia: validDate(dadosProcesso.dataDistribuicao),
          dataAjuizamento: validDate(dadosProcesso.dataAjuizamento),
          valorCausa: valorInteiro(dadosProcesso.valorCausa),
          orgaoJulgador: dadosProcesso.orgaoJulgador,
          orgaoJulgadorCodigo: dadosProcesso.orgaoJulgadorCodigo,
          nivelSigilo: dadosProcesso.nivelSigilo,
          sistema: dadosProcesso.sistema,
          formato: dadosProcesso.formato,
          ultimaMovimentacao: ultimaDataValida(dadosProcesso.movimentacoes),
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
        const updateData: ProcessoUpdateData = {
          classe: dadosProcesso.classe || processo.classe,
          assunto: dadosProcesso.assunto || processo.assunto,
          assuntoPrincipal: dadosProcesso.assuntoPrincipal || processo.assuntoPrincipal,
          ultimaMovimentacao:
            ultimaDataValida(dadosProcesso.movimentacoes) || processo.ultimaMovimentacao,
          valorCausa: valorInteiro(dadosProcesso.valorCausa) || processo.valorCausa,
          orgaoJulgador: dadosProcesso.orgaoJulgador || processo.orgaoJulgador,
          nivelSigilo: dadosProcesso.nivelSigilo ?? processo.nivelSigilo,
          dadosOriginais: dadosProcesso.dadosOriginais,
          enriquecido: true, // Marcado como enriquecido quando dados sao atualizados
        };
        if (advogadoId) {
          updateData.advogadoId = advogadoId;
        }
        await processo.update(
          updateData,
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

      if (advogadoId) {
        await this.garantirMonitoramentoDiario(processo.id, advogadoId, t);
      }

      return {
        processo,
        ehNovo,
        totalMovimentacoes: dadosProcesso.movimentacoes.length,
        novasMovimentacoes: resultadoMovimentacoes.novas,
      };
    });
  }

  private async garantirMonitoramentoDiario(
    processoId: string,
    advogadoId: string,
    t: Transaction
  ): Promise<void> {
    const existente = await Monitoramento.findOne({
      where: { processoId, ativo: true },
      transaction: t,
    });

    if (existente) {
      return;
    }

    await Monitoramento.create({
      processoId,
      advogadoId,
      intervaloMinutos: DEFAULT_PROCESS_MONITORING_INTERVAL_MINUTES,
      ativo: true,
      ultimoPoll: new Date(),
    }, { transaction: t });
  }

  private async garantirMonitoramentoDiarioSemTransacao(
    processoId: string,
    advogadoId?: string
  ): Promise<void> {
    if (!advogadoId) return;

    const existente = await Monitoramento.findOne({
      where: { processoId, ativo: true },
    });

    if (existente) return;

    await Monitoramento.create({
      processoId,
      advogadoId,
      intervaloMinutos: DEFAULT_PROCESS_MONITORING_INTERVAL_MINUTES,
      ativo: true,
      ultimoPoll: new Date(),
    });
  }

  private async salvarResumoProcessoOAB(
    proc: ResultadoBusca['processos'][number],
    tribunalCodigo: string,
    advogadoId?: string
  ): Promise<string> {
    const tribunal = await Tribunal.findOne({ where: { codigo: tribunalCodigo } });
    if (!tribunal) {
      throw new Error(`Tribunal não encontrado no banco: ${tribunalCodigo}`);
    }

    const dadosResumo = {
      tribunalId: tribunal.id,
      advogadoId,
      status: 'MONITORANDO' as const,
      classe: proc.classe,
      classeCodigo: proc.classeCodigo,
      assunto: proc.assunto,
      assuntoPrincipal: proc.assuntoPrincipal,
      instancia: (proc.instancia || 'PRIMEIRA') as 'PRIMEIRA' | 'SEGUNDA' | 'SUPERIOR',
      dataAjuizamento: dataValida(proc.dataAjuizamento),
      valorCausa: valorInteiro(proc.valorCausa),
      orgaoJulgador: proc.orgaoJulgador,
      orgaoJulgadorCodigo: proc.orgaoJulgadorCodigo,
      sistema: proc.sistema,
      formato: proc.formato,
      dadosOriginais: {
        fonte: 'oab_search_summary',
        tribunalCodigo,
        resumo: proc,
      },
      enriquecido: false,
    };

    const existente = await Processo.findOne({
      where: { numeroProcesso: proc.numeroProcesso },
    });

    if (existente) {
      const updateData: Partial<typeof dadosResumo> = {
        tribunalId: dadosResumo.tribunalId,
      };
      if (advogadoId) updateData.advogadoId = advogadoId;

      if (existente.enriquecido !== true) {
        Object.assign(updateData, dadosResumo);
      }

      await existente.update(updateData);
      await this.garantirMonitoramentoDiarioSemTransacao(existente.id, advogadoId);
      return existente.numeroProcesso;
    }

    const processo = await Processo.create({
      numeroProcesso: proc.numeroProcesso,
      ...dadosResumo,
    });
    await this.garantirMonitoramentoDiarioSemTransacao(processo.id, advogadoId);
    return processo.numeroProcesso;
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

    const partesData: Array<{
      processoId: string;
      nome: string;
      tipo: DadosProcesso['partes'][number]['tipo'];
      documento?: string;
      isAdvogado: boolean;
    }> = [];
    const advogadosIncluidos = new Set<string>();

    for (const p of partes) {
      partesData.push({
        processoId,
        nome: p.nome,
        tipo: p.tipo,
        documento: p.documento,
        isAdvogado: p.isAdvogado,
      });

      for (const advogado of p.advogados ?? []) {
        if (!advogado.nome) continue;
        const key = `${advogado.nome}|${advogado.numeroOAB ?? ''}|${advogado.ufOAB ?? ''}`.toUpperCase();
        if (advogadosIncluidos.has(key)) continue;
        advogadosIncluidos.add(key);

        const oabDocumento = [advogado.numeroOAB, advogado.ufOAB].filter(Boolean).join('/');
        partesData.push({
          processoId,
          nome: advogado.nome,
          tipo: 'ADVOGADO',
          documento: oabDocumento || undefined,
          isAdvogado: true,
        });
      }
    }

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
    const movimentacoesValidas = movimentacoes.filter(m => validDate(m.data));
    const ultimaMovimentacao = await Movimentacao.findOne({
      where: { processoId },
      order: [['data', 'DESC']],
      transaction: t,
    });

    const dataUltimaRegistrada = ultimaMovimentacao?.data || new Date(0);

    const movimentacoesNovas = movimentacoesValidas.filter(m => m.data > dataUltimaRegistrada);

    if (movimentacoesNovas.length === 0) {
      return { novas: 0, total: movimentacoesValidas.length };
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
      origem: limitarTexto(m.origem, 50),
      dadosOriginais: m.dadosOriginais,
      nova: m.data >= dataLimiteNova,
    }));

    await Movimentacao.bulkCreate(movimentacoesData, { transaction: t });

    const totalNovasRecentes = movimentacoesData.filter(m => m.nova).length;
    const totalDuplicadasIgnoradas = movimentacoesNovas.length - movimentacoesSemDuplicidade.length;
    logger.info(
      `Salvas ${movimentacoesSemDuplicidade.length} movimentações para processo ${processoId} (${totalNovasRecentes} recentes, ${totalDuplicadasIgnoradas} duplicadas ignoradas)`
    );

    return { novas: totalNovasRecentes, total: movimentacoes.length };
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
    forceRefresh = false,
    limiteProcessos?: number,
    onlyMissing = false
  ): Promise<{
    processos: ProcessoApiResponse[];
    doCache: boolean;
    tempoMs: number;
    fontes?: ResultadoBusca['fontes'];
  }> {
    const inicio = Date.now();
    const oabNormalizada = oab.toUpperCase().replace(/\s/g, '');
    const oabCacheKeys = buildOABCacheKeys(oabNormalizada);
    const buscaLimitada = typeof limiteProcessos === 'number' && limiteProcessos > 0;
    const carregarProcessos = (numeros: string[]) =>
      Processo.findAll({
        where: { numeroProcesso: numeros },
        include: [
          { model: Parte, as: 'partes' },
          { model: Movimentacao, as: 'movimentacoes' },
        ],
      });

    if (forceRefresh || onlyMissing) {
      for (const cacheKey of oabCacheKeys) {
        oabCacheService.invalidate(cacheKey, tribunalCodigo);
      }
      await OABBuscaCache.destroy({
        where: {
          oab: { [Op.in]: oabCacheKeys },
          tribunalCodigo,
        },
      });
    }

    // ===== L1: Cache em memória (verifica primeiro - mais rápido) =====
    if (!forceRefresh && !onlyMissing && !buscaLimitada) {
      const entryL1 = oabCacheService.get(oabNormalizada, tribunalCodigo);
      if (entryL1) {
        logger.info(`[Cache OAB] L1 HIT para ${oabNormalizada} em ${tribunalCodigo}`);
        const processos = await montarProcessosParaApi(
          entryL1.processos,
          tribunalCodigo,
          (entryL1.resumo as OABProcessoResumo[]) || [],
          carregarProcessos
        );
        const tempoMs = Date.now() - inicio;
        return { processos, doCache: true, tempoMs };
      }
    }

    // ===== L2: Cache de banco (se L1 miss) =====
    if (!forceRefresh && !onlyMissing && !buscaLimitada) {
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
        const resumo = extrairResumoCache(cacheEntryL2.resultadoJson);

        // Popula L1 com dado do L2 para próximas consultas serem instantâneas
        oabCacheService.set(
          oabNormalizada,
          tribunalCodigo,
          numerosProcesso,
          undefined,
          nome,
          resumo
        );

        const processos = await montarProcessosParaApi(
          numerosProcesso,
          tribunalCodigo,
          resumo,
          carregarProcessos
        );
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
    const fontes = resultado.fontes || [];
    let processosResultado = buscaLimitada
      ? resultado.processos.slice(0, Math.max(1, Math.floor(limiteProcessos)))
      : resultado.processos;

    if (onlyMissing && processosResultado.length > 0) {
      const numerosResultado = Array.from(
        new Set(processosResultado.map(proc => normalizarNumeroProcesso(proc.numeroProcesso)))
      );
      const processosExistentes = await Processo.findAll({
        where: { numeroProcesso: { [Op.in]: numerosResultado } },
        attributes: ['numeroProcesso'],
        raw: true,
      });
      const numerosExistentes = new Set(
        processosExistentes.map(proc => normalizarNumeroProcesso(proc.numeroProcesso))
      );
      processosResultado = processosResultado.filter(
        proc => !numerosExistentes.has(normalizarNumeroProcesso(proc.numeroProcesso))
      );
      logger.info(
        `[Cache OAB] Modo somente ausentes para ${oabNormalizada}: ${processosResultado.length}/${numerosResultado.length} processos ainda nao cadastrados`
      );
    }

    const numerosProcessos: string[] = [];
    const resumoOab: OABProcessoResumo[] = [];
    const enriquecidosComSucesso: string[] = [];

    // Adiciona TODOS os números ao cache
    for (const proc of processosResultado) {
      numerosProcessos.push(proc.numeroProcesso);
      resumoOab.push({
        numeroProcesso: proc.numeroProcesso,
        tribunalCodigo: proc.tribunalCodigo || tribunalCodigo,
        classe: proc.classe,
        classeCodigo: proc.classeCodigo,
        assunto: proc.assunto,
        assuntoPrincipal: proc.assuntoPrincipal,
        dataAjuizamento: proc.dataAjuizamento,
        orgaoJulgador: proc.orgaoJulgador,
        orgaoJulgadorCodigo: proc.orgaoJulgadorCodigo,
        valorCausa: proc.valorCausa,
        instancia: proc.instancia,
        formato: proc.formato,
        sistema: proc.sistema,
        partes: proc.partes,
        advogados: proc.advogados,
        movimentacoes: proc.movimentacoes,
      });
    }

    logger.info(`[Cache OAB] ${processosResultado.length} processos encontrados. Enriquecendo todos...`);

    // Busca e salva TODOS os processos em paralelo
    for (let i = 0; i < processosResultado.length; i += MAX_PARALLEL_FETCHES) {
      const batch = processosResultado.slice(i, i + MAX_PARALLEL_FETCHES);
      const results = await Promise.allSettled(
        batch.map(proc =>
          withTimeout(
            this.buscarESalvarProcesso(proc.numeroProcesso, tribunalCodigo, advogadoId)
              .then(resultado => resultado.processo.numeroProcesso),
            ENRICHMENT_TIMEOUT_MS,
            `Enriquecimento ${proc.numeroProcesso}`
          ).catch(async error => {
            logger.warn(`Falha ao processar processo ${proc.numeroProcesso}: ${error}`);
            try {
              return await this.salvarResumoProcessoOAB(proc, tribunalCodigo, advogadoId);
            } catch (fallbackError) {
              logger.warn(`Falha ao salvar resumo OAB ${proc.numeroProcesso}: ${fallbackError}`);
              return null;
            }
          })
        )
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) {
          enriquecidosComSucesso.push(r.value);
        }
      }
      logger.info(`[Cache OAB] Enriquecidos ${Math.min(i + MAX_PARALLEL_FETCHES, processosResultado.length)}/${processosResultado.length} processos`);
    }

    const numerosPersistidos = Array.from(new Set(enriquecidosComSucesso));

    // Salva nos dois níveis de cache
    const ttlMs = CACHE_TTL_MINUTES * 60 * 1000;

    if (!buscaLimitada && !onlyMissing) {
      // L1: Cache em memória
      oabCacheService.set(oabNormalizada, tribunalCodigo, numerosProcessos, ttlMs, nome, resumoOab);

      // L2: Cache no banco
      const expiraEm = new Date();
      expiraEm.setMinutes(expiraEm.getMinutes() + CACHE_TTL_MINUTES);

      await OABBuscaCache.upsert({
        oab: oabNormalizada,
        tribunalCodigo,
        resultadoJson: { numerosProcessos, resumo: resumoOab },
        totalProcessos: numerosProcessos.length,
        expiraEm,
      });
    }

    const processos = await montarProcessosParaApi(
      numerosProcessos,
      tribunalCodigo,
      resumoOab,
      carregarProcessos
    );

    const tempoMs = Date.now() - inicio;
    logger.info(`[Cache OAB] Busca completada para ${oabNormalizada}: ${numerosProcessos.length} processos (${numerosPersistidos.length} persistidos) em ${tempoMs}ms`);

    return { processos, doCache: false, tempoMs, fontes };
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
