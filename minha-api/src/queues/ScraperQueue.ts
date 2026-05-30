/**
 * Sistema de Filas para Scraping de Processos
 * Usa Bull + Redis para processamento assíncrono
 */

import Bull, { Queue, Job } from 'bull';
import { registry } from '../tribunais';
import TribunalService from '../services/TribunalService';
import FirecrawlEnrichmentService from '../services/FirecrawlEnrichmentService';
import logger from '../config/logger';
import { getRedisUrl } from '../config/redis';
import ProcessoMonitoramentoService from '../services/ProcessoMonitoramentoService';
import Monitoramento from '../models/Monitoramento';
import Processo from '../models/Processo';
import Notification from '../models/Notification';
import JobModel from '../models/Job';
import notificationService from '../websocket/NotificationService';
import { derivarTribunaisPorOAB } from '../utils/derivarTribunaisPorOAB';

// Configuração da fila
const REDIS_URL = getRedisUrl();

export interface ScrapeJobData {
  tipo?: 'PROCESSO' | 'INITIAL_OAB_CRAWL' | 'OAB_CRAWL' | 'FIRECRAWL_AUX';
  numeroProcesso: string;
  tribunalCodigo: string;
  advogadoId?: string;
  processoId?: string; // Se já existir no banco
  monitoramentoId?: string;
  prioridade?: number;
  oab?: string;
  nome?: string;
  requestedBy?: string;
  source?: 'admin-create' | 'self-register';
  correlationId?: string;
  tribunais?: string[];
  urls?: string[];
  forceRefresh?: boolean;
  onlyMainContent?: boolean;
}

export interface ScrapeJobResult {
  sucesso: boolean;
  processoId?: string;
  novasMovimentacoes?: number;
  erro?: string;
  tipo?: 'PROCESSO' | 'INITIAL_OAB_CRAWL' | 'OAB_CRAWL' | 'FIRECRAWL_AUX';
  totalEncontrados?: number;
  totalSalvos?: number;
  firecrawl?: {
    totalUrls: number;
    totalOk: number;
    updatedAt: string;
  };
}

async function registrarNotificacaoMovimentacao(
  processoId: string,
  numeroProcesso: string,
  advogadoId: string,
  quantidade: number
): Promise<void> {
  const mensagem = `${quantidade} nova${quantidade === 1 ? '' : 's'} movimentação${quantidade === 1 ? '' : 'ões'} no processo ${numeroProcesso}`;

  await Notification.create({
    advogadoId,
    processoId,
    tipo: 'NOVA_MOVIMENTACAO',
    mensagem,
    dados: {
      numeroProcesso,
      novasMovimentacoes: quantidade,
    },
  });

  notificationService.novaMovimentacao(processoId, numeroProcesso, advogadoId, quantidade);
}

async function registrarErroScraping(job: Job<ScrapeJobData>, message: string): Promise<void> {
  const { processoId, numeroProcesso, advogadoId, monitoramentoId } = job.data;

  if (monitoramentoId) {
    await Monitoramento.update(
      { ultimoPoll: new Date(0) },
      { where: { id: monitoramentoId } }
    );
  }

  if (!processoId || !advogadoId) return;

  await Notification.create({
    advogadoId,
    processoId,
    tipo: 'ERRO_SCRAPING',
    mensagem: `Falha ao atualizar o processo ${numeroProcesso}`,
    dados: { numeroProcesso, erro: message },
  });

  notificationService.erroScraping(processoId, numeroProcesso, advogadoId, message);
}

async function atualizarJobAuditoriaFila(
  mode: string,
  queueJobId: string,
  data: Partial<{
    status: 'PENDENTE' | 'PROCESSANDO' | 'CONCLUIDO' | 'FALHO';
    erro?: string;
    completedAt?: Date;
    tentativas?: number;
  }>
): Promise<void> {
  const jobs = await JobModel.findAll({
    where: { tipo: 'SCRAPE' },
    order: [['createdAt', 'DESC']],
    limit: 500,
  });

  const auditJob = jobs.find((candidate) => {
    const payload = (candidate.payload ?? {}) as Record<string, unknown>;
    return payload.mode === mode && payload.queueJobId === queueJobId;
  });

  if (auditJob) {
    await auditJob.update(data);
  }
}

// Criação da fila
const scrapeQueue: Queue<ScrapeJobData> = new Bull('scrape-processos', REDIS_URL, {
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // 5 segundos inicial
    },
    removeOnComplete: 100, // Mantém últimos 100 jobs completos
    removeOnFail: 50, // Mantém últimos 50 jobs falhos
  },
  limiter: {
    max: 10, // Máximo 10 jobs por segundo
    duration: 1000,
  },
});

// Events para logging
scrapeQueue.on('error', (error) => {
  logger.error('ScrapeQueue error:', error);
});

scrapeQueue.on('failed', (job, err) => {
  logger.error(`Job ${job.id} failed:`, { 
    error: err.message, 
    attemptsMade: job.attemptsMade 
  });

  const { tipo } = job.data || {};
  const maxAttempts = job.opts.attempts || 1;
  if (tipo !== 'INITIAL_OAB_CRAWL' && job.attemptsMade >= maxAttempts) {
    void registrarErroScraping(job, err.message).catch((updateError) => {
      logger.warn('Falha ao registrar erro de scraping', {
        queueJobId: job.id,
        error: (updateError as Error).message,
      });
    });
  }

  if (tipo === 'INITIAL_OAB_CRAWL') {
    void JobModel.findAll({
      where: { tipo: 'SCRAPE' },
      order: [['createdAt', 'DESC']],
      limit: 500,
    }).then((jobs) => {
      const auditJob = jobs.find((candidate) => {
        const payload = (candidate.payload ?? {}) as Record<string, unknown>;
        return payload.mode === 'initial_oab_crawl' && payload.queueJobId === String(job.id);
      });
      if (auditJob) {
        return auditJob.update({
          status: 'FALHO',
          erro: err.message,
          completedAt: new Date(),
          tentativas: job.attemptsMade,
        });
      }
      return null;
    }).catch((updateError) => {
      logger.warn('Falha ao atualizar status de auditoria (failed)', {
        queueJobId: job.id,
        error: (updateError as Error).message,
      });
    });
  }

  if (tipo === 'OAB_CRAWL') {
    void atualizarJobAuditoriaFila('oab_crawl', String(job.id), {
      status: 'FALHO',
      erro: err.message,
      completedAt: new Date(),
      tentativas: job.attemptsMade,
    }).catch((updateError) => {
      logger.warn('Falha ao atualizar status de auditoria OAB (failed)', {
        queueJobId: job.id,
        error: (updateError as Error).message,
      });
    });
  }

  if (tipo === 'FIRECRAWL_AUX') {
    void atualizarJobAuditoriaFila('firecrawl_aux', String(job.id), {
      status: 'FALHO',
      erro: err.message,
      completedAt: new Date(),
      tentativas: job.attemptsMade,
    }).catch((updateError) => {
      logger.warn('Falha ao atualizar status de auditoria Firecrawl (failed)', {
        queueJobId: job.id,
        error: (updateError as Error).message,
      });
    });
  }
});

scrapeQueue.on('completed', (job, result) => {
  logger.info(`Job ${job.id} completed:`, result);

  const { tipo } = job.data || {};
  if (tipo === 'INITIAL_OAB_CRAWL') {
    void JobModel.findAll({
      where: { tipo: 'SCRAPE' },
      order: [['createdAt', 'DESC']],
      limit: 500,
    }).then((jobs) => {
      const auditJob = jobs.find((candidate) => {
        const payload = (candidate.payload ?? {}) as Record<string, unknown>;
        return payload.mode === 'initial_oab_crawl' && payload.queueJobId === String(job.id);
      });
      if (auditJob) {
        return auditJob.update({
          status: (result as ScrapeJobResult)?.sucesso ? 'CONCLUIDO' : 'FALHO',
          erro: (result as ScrapeJobResult)?.erro,
          completedAt: new Date(),
          tentativas: job.attemptsMade,
        });
      }
      return null;
    }).catch((updateError) => {
      logger.warn('Falha ao atualizar status de auditoria (completed)', {
        queueJobId: job.id,
        error: (updateError as Error).message,
      });
    });
  }

  if (tipo === 'OAB_CRAWL') {
    void atualizarJobAuditoriaFila('oab_crawl', String(job.id), {
      status: (result as ScrapeJobResult)?.sucesso ? 'CONCLUIDO' : 'FALHO',
      erro: (result as ScrapeJobResult)?.erro,
      completedAt: new Date(),
      tentativas: job.attemptsMade,
    }).catch((updateError) => {
      logger.warn('Falha ao atualizar status de auditoria OAB (completed)', {
        queueJobId: job.id,
        error: (updateError as Error).message,
      });
    });
  }

  if (tipo === 'FIRECRAWL_AUX') {
    void atualizarJobAuditoriaFila('firecrawl_aux', String(job.id), {
      status: (result as ScrapeJobResult)?.sucesso ? 'CONCLUIDO' : 'FALHO',
      erro: (result as ScrapeJobResult)?.erro,
      completedAt: new Date(),
      tentativas: job.attemptsMade,
    }).catch((updateError) => {
      logger.warn('Falha ao atualizar status de auditoria Firecrawl (completed)', {
        queueJobId: job.id,
        error: (updateError as Error).message,
      });
    });
  }
});

/**
 * Adiciona job de scraping na fila
 */
export async function agendarScraping(data: ScrapeJobData): Promise<Job<ScrapeJobData>> {
  const deterministicScope = data.monitoramentoId || data.processoId || data.advogadoId;
  const deterministicJobId = deterministicScope
    ? [
      'scrape',
      data.tipo || 'PROCESSO',
      data.tribunalCodigo,
      data.numeroProcesso,
      deterministicScope,
    ].join('-')
    : [
      'scrape',
      data.tipo || 'PROCESSO',
      data.tribunalCodigo,
      data.numeroProcesso,
      Date.now(),
    ].join('-');

  const job = await scrapeQueue.add(data, {
    priority: data.prioridade || 2,
    jobId: deterministicJobId,
  });
  
  logger.info(`Scraping agendado: ${data.numeroProcesso} em ${data.tribunalCodigo}`, { jobId: job.id });
  
  return job;
}

/**
 * Agenda busca inicial por OAB (fire-and-forget) para onboarding de advogado
 */
export async function agendarInitialOABCrawl(
  data: Omit<ScrapeJobData, 'numeroProcesso' | 'tribunalCodigo' | 'tipo'> & {
    advogadoId: string;
    oab: string;
    tribunais?: string[];
  }
): Promise<Job<ScrapeJobData>> {
  const oabNormalizada = data.oab.toUpperCase().replace(/\s/g, '');
  const cooldownMs = Number(process.env.INITIAL_OAB_CRAWL_COOLDOWN_MS || 5 * 60 * 1000);
  const threshold = Date.now() - cooldownMs;

  const jobsAtivos = await scrapeQueue.getJobs(['waiting', 'active', 'delayed']);
  const duplicate = jobsAtivos.find((job) => {
    const payload = job.data as ScrapeJobData;
    return payload.tipo === 'INITIAL_OAB_CRAWL' &&
      payload.advogadoId === data.advogadoId &&
      payload.oab?.toUpperCase().replace(/\s/g, '') === oabNormalizada &&
      job.timestamp >= threshold;
  });

  if (duplicate) {
    logger.info('Initial OAB crawl já agendado recentemente', {
      advogadoId: data.advogadoId,
      oab: oabNormalizada,
      existingJobId: duplicate.id,
    });
    return duplicate as Job<ScrapeJobData>;
  }

  // Deriva tribunais automaticamente pela UF da OAB, ou usa especificados, ou usa todos
  let tribunaisAlvo: string[];
  
  if (data.tribunais && data.tribunais.length > 0) {
    // Se tribunais foram especificados explicitamente, usa eles
    tribunaisAlvo = data.tribunais.map((t: string) => t.toUpperCase());
  } else {
    // Deriva tribunais pela UF da OAB
    const derivacao = derivarTribunaisPorOAB(data.oab);
    if (derivacao && derivacao.length > 0) {
      tribunaisAlvo = derivacao;
      logger.info(`Tribunais derivados da OAB ${data.oab}: ${tribunaisAlvo.join(', ')}`);
    } else {
      // Sem UF na OAB: usa a env var ou busca todos os tribunais
      const tribunaisPadrao = process.env.INITIAL_OAB_TRIBUNAIS?.split(',')
        .map((codigo) => codigo.trim().toUpperCase())
        .filter(Boolean);
      
      if (tribunaisPadrao && tribunaisPadrao.length > 0) {
        tribunaisAlvo = tribunaisPadrao;
      } else {
        // Busca em todos os tribunais disponíveis no registry
        tribunaisAlvo = registry.listar().map(t => t.codigo);
      }
    }
  }

  const job = await scrapeQueue.add({
    ...data,
    tipo: 'INITIAL_OAB_CRAWL',
    oab: oabNormalizada,
    numeroProcesso: '__INITIAL_OAB_CRAWL__',
    tribunalCodigo: '__MULTI__',
    tribunais: tribunaisAlvo,
  }, {
    priority: data.prioridade || 1,
    jobId: `initial-oab-${data.advogadoId}-${oabNormalizada}`,
    removeOnComplete: false,
    removeOnFail: false,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 15000,
    },
  });

  logger.info('Initial OAB crawl agendado', {
    advogadoId: data.advogadoId,
    oab: oabNormalizada,
    tribunais: tribunaisAlvo,
    correlationId: data.correlationId,
    jobId: job.id,
  });

  return job;
}

export async function agendarOABCrawl(data: {
  advogadoId: string;
  oab: string;
  nome?: string;
  tribunais: string[];
  requestedBy?: string;
  correlationId?: string;
  prioridade?: number;
}): Promise<Job<ScrapeJobData>> {
  const oabNormalizada = data.oab.toUpperCase().replace(/\s/g, '');
  const tribunaisAlvo = data.tribunais.map((codigo) => codigo.toUpperCase());

  const job = await scrapeQueue.add({
    tipo: 'OAB_CRAWL',
    numeroProcesso: '__OAB_CRAWL__',
    tribunalCodigo: '__MULTI__',
    advogadoId: data.advogadoId,
    oab: oabNormalizada,
    nome: data.nome,
    tribunais: tribunaisAlvo,
    requestedBy: data.requestedBy,
    correlationId: data.correlationId,
  }, {
    priority: data.prioridade || 1,
    jobId: `oab-crawl-${data.advogadoId}-${oabNormalizada}-${tribunaisAlvo.join('-')}-${Date.now()}`,
    removeOnComplete: false,
    removeOnFail: false,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 15000,
    },
  });

  logger.info('Busca OAB assíncrona agendada', {
    advogadoId: data.advogadoId,
    oab: oabNormalizada,
    tribunais: tribunaisAlvo,
    correlationId: data.correlationId,
    jobId: job.id,
  });

  return job;
}

export async function agendarFirecrawlEnrichment(data: {
  processoId: string;
  numeroProcesso: string;
  tribunalCodigo?: string;
  urls: string[];
  forceRefresh?: boolean;
  onlyMainContent?: boolean;
  requestedBy?: string;
  correlationId?: string;
  prioridade?: number;
}): Promise<Job<ScrapeJobData>> {
  const job = await scrapeQueue.add({
    tipo: 'FIRECRAWL_AUX',
    numeroProcesso: data.numeroProcesso,
    tribunalCodigo: data.tribunalCodigo || '__AUX__',
    processoId: data.processoId,
    urls: data.urls,
    forceRefresh: data.forceRefresh,
    onlyMainContent: data.onlyMainContent,
    requestedBy: data.requestedBy,
    correlationId: data.correlationId,
  }, {
    priority: data.prioridade || 3,
    jobId: `firecrawl-aux-${data.processoId}-${Date.now()}`,
    removeOnComplete: false,
    removeOnFail: false,
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 15000,
    },
  });

  logger.info('Enriquecimento Firecrawl agendado', {
    processoId: data.processoId,
    numeroProcesso: data.numeroProcesso,
    totalUrls: data.urls.length,
    correlationId: data.correlationId,
    jobId: job.id,
  });

  return job;
}

async function processInitialOABCrawl(job: Job<ScrapeJobData>): Promise<ScrapeJobResult> {
  const { advogadoId, oab, nome, tribunais = [], correlationId } = job.data;

  // Se tribunais vier vazio (edge case), deriva novamente
  let tribunaisAlvo = tribunais;
  if ((!tribunaisAlvo || tribunaisAlvo.length === 0) && oab) {
    const derivacao = derivarTribunaisPorOAB(oab!);
    if (derivacao && derivacao.length > 0) {
      tribunaisAlvo = derivacao;
    } else {
      tribunaisAlvo = registry.listar().map(t => t.codigo);
    }
    logger.info(`Tribunais re-derivados para ${oab}: ${tribunaisAlvo.join(', ')}`);
  }

  if (!advogadoId || !oab) {
    throw new Error('Job INITIAL_OAB_CRAWL inválido: advogadoId e oab são obrigatórios');
  }

  let totalEncontrados = 0;
  let totalSalvos = 0;
  let tribunaisComErro = 0;

  for (const tribunalCodigoRaw of tribunaisAlvo) {
    const tribunalCodigo = tribunalCodigoRaw.toUpperCase();
    const adapter = registry.get(tribunalCodigo);

    if (!adapter) {
      logger.warn('Tribunal ignorado no initial_oab_crawl (não suportado)', {
        tribunalCodigo,
        advogadoId,
        oab,
        correlationId,
      });
      continue;
    }

    try {
      const resultadoBusca = await TribunalService.buscarPorOABComCache(
        oab,
        tribunalCodigo,
        nome,
        advogadoId,
        false,
        undefined,
        false
      );

      totalEncontrados += resultadoBusca.processos.length;
      totalSalvos += resultadoBusca.processos.length;
    } catch (error) {
      tribunaisComErro += 1;
      logger.warn('Falha ao buscar OAB em tribunal durante crawl; seguindo para o próximo', {
        tribunalCodigo,
        advogadoId,
        oab,
        correlationId,
        error: (error as Error).message,
      });
    }
  }

  if (totalSalvos === 0) {
    const processosExistentes = await Processo.count({ where: { advogadoId } });
    logger.info('Initial OAB crawl concluído sem novos processos', {
      advogadoId,
      oab,
      correlationId,
      totalEncontrados,
      processosExistentes,
    });
  }

  try {
    await ProcessoMonitoramentoService.cadastrarOABMonitorada(oab, undefined, 5);
  } catch (error) {
    logger.warn('Falha ao garantir monitoramento contínuo da OAB', {
      advogadoId,
      oab,
      correlationId,
      error: (error as Error).message,
    });
  }

  return {
    sucesso: true,
    tipo: 'INITIAL_OAB_CRAWL',
    totalEncontrados,
    totalSalvos,
    erro: tribunaisComErro > 0 ? `${tribunaisComErro} tribunal(is) falharam durante a varredura.` : undefined,
  };
}

/**
 * Adiciona múltiplos jobs de scraping (batch)
 */
export async function agendarScrapingBatch(
  items: ScrapeJobData[]
): Promise<Job<ScrapeJobData>[]> {
  const jobs = await scrapeQueue.addBulk(
    items.map((item) => ({
      data: item,
      opts: {
        priority: item.prioridade || 2,
        jobId: [
          'scrape',
          item.tipo || 'PROCESSO',
          item.tribunalCodigo,
          item.numeroProcesso,
          item.monitoramentoId || item.processoId || item.advogadoId || `batch-${Date.now()}`,
        ].join('-'),
      },
    }))
  );
  
  logger.info(`Batch de ${items.length} scrapings agendados`);
  
  return jobs;
}

let processorStarted = false;

/**
 * Inicia o processador de jobs de scraping.
 *
 * A API importa este módulo para enfileirar jobs, mas não deve processá-los.
 * Somente o worker chama esta função para evitar scraping pesado no processo HTTP.
 */
export function startScrapeQueueProcessor(): void {
  if (processorStarted) {
    logger.warn('ScrapeQueue processor já iniciado neste processo');
    return;
  }

  processorStarted = true;

  scrapeQueue.process(async (job: Job<ScrapeJobData>): Promise<ScrapeJobResult> => {
    const { tipo = 'PROCESSO', numeroProcesso, tribunalCodigo, advogadoId, processoId, correlationId, monitoramentoId } = job.data;

    logger.info(`Processando scraping: ${tipo}`, { jobId: job.id, correlationId });

    try {
      if (tipo === 'INITIAL_OAB_CRAWL') {
        return processInitialOABCrawl(job);
      }

      if (tipo === 'OAB_CRAWL') {
        const result = await processInitialOABCrawl(job);
        return { ...result, tipo: 'OAB_CRAWL' };
      }

      if (tipo === 'FIRECRAWL_AUX') {
        if (!processoId) {
          throw new Error('Job FIRECRAWL_AUX inválido: processoId é obrigatório');
        }

        const enrichment = await FirecrawlEnrichmentService.enrichProcesso({
          processoId,
          urls: job.data.urls || [],
          forceRefresh: job.data.forceRefresh,
          onlyMainContent: job.data.onlyMainContent,
        });

        return {
          sucesso: enrichment.results.some(result => result.ok),
          tipo: 'FIRECRAWL_AUX',
          processoId,
          firecrawl: {
            totalUrls: enrichment.results.length,
            totalOk: enrichment.results.filter(result => result.ok).length,
            updatedAt: enrichment.updatedAt,
          },
        };
      }

      // Verifica se o adapter existe
      const adapter = registry.get(tribunalCodigo);
      if (!adapter) {
        throw new Error(`Tribunal não suportado: ${tribunalCodigo}`);
      }

      // Executa a busca e salvamento
      const resultado = await TribunalService.buscarESalvarProcesso(
        numeroProcesso,
        tribunalCodigo,
        advogadoId
      );

      if (monitoramentoId) {
        await Monitoramento.update(
          { ultimoPoll: new Date() },
          { where: { id: monitoramentoId } }
        );
      }

      if (!resultado.ehNovo && advogadoId && resultado.novasMovimentacoes > 0) {
        try {
          await registrarNotificacaoMovimentacao(
            resultado.processo.id,
            resultado.processo.numeroProcesso,
            advogadoId,
            resultado.novasMovimentacoes
          );
        } catch (notificationError) {
          logger.warn('Movimentações novas salvas, mas a notificação falhou', {
            processoId: resultado.processo.id,
            novasMovimentacoes: resultado.novasMovimentacoes,
            error: (notificationError as Error).message,
          });
        }
      }

      return {
        sucesso: true,
        tipo: 'PROCESSO',
        processoId: resultado.processo.id,
        novasMovimentacoes: resultado.novasMovimentacoes,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error(`Erro no scraping de ${numeroProcesso}:`, error);
      throw error instanceof Error ? error : new Error(message);
    }
  });

  logger.info('ScrapeQueue processor iniciado');
}

/**
 * Obtém estatísticas da fila
 */
export async function getQueueStats(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    scrapeQueue.getWaitingCount(),
    scrapeQueue.getActiveCount(),
    scrapeQueue.getCompletedCount(),
    scrapeQueue.getFailedCount(),
    scrapeQueue.getDelayedCount(),
  ]);
  
  return { waiting, active, completed, failed, delayed };
}

/**
 * Obtém job pelo ID
 */
export async function getJob(jobId: string): Promise<Job<ScrapeJobData> | null> {
  return scrapeQueue.getJob(jobId);
}

/**
 * Pausa a fila (para manutenção)
 */
export async function pauseQueue(): Promise<void> {
  await scrapeQueue.pause();
  logger.warn('Fila de scraping PAUSADA');
}

/**
 * Retoma a fila
 */
export async function resumeQueue(): Promise<void> {
  await scrapeQueue.resume();
  logger.info('Fila de scraping RETOMADA');
}

/**
 * Limpa jobs antigos
 */
export async function cleanOldJobs(): Promise<void> {
  const old = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 dias
  await scrapeQueue.clean(old, 'completed');
  await scrapeQueue.clean(old, 'failed');
  logger.info('Jobs antigos limpos da fila');
}

export { scrapeQueue };
export default scrapeQueue;
