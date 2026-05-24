/**
 * Sistema de Filas para Scraping de Processos
 * Usa Bull + Redis para processamento assíncrono
 */

import Bull, { Queue, Job } from 'bull';
import { registry } from '../tribunais';
import TribunalService from '../services/TribunalService';
import logger from '../config/logger';
import ProcessoMonitoramentoService from '../services/ProcessoMonitoramentoService';
import Monitoramento from '../models/Monitoramento';
import Processo from '../models/Processo';
import JobModel from '../models/Job';
// TribunalDerivacaoService removed - stub functions
const derivarTribunaisPorOAB = (_oab: string): string[] => [];

// Configuração da fila
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export interface ScrapeJobData {
  tipo?: 'PROCESSO' | 'INITIAL_OAB_CRAWL';
  numeroProcesso: string;
  tribunalCodigo: string;
  advogadoId?: string;
  processoId?: string; // Se já existir no banco
  prioridade?: number;
  oab?: string;
  nome?: string;
  requestedBy?: string;
  source?: 'admin-create' | 'self-register';
  correlationId?: string;
  tribunais?: string[];
}

export interface ScrapeJobResult {
  sucesso: boolean;
  processoId?: string;
  novasMovimentacoes?: number;
  erro?: string;
  tipo?: 'PROCESSO' | 'INITIAL_OAB_CRAWL';
  totalEncontrados?: number;
  totalSalvos?: number;
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
  if (tipo === 'INITIAL_OAB_CRAWL') {
    void JobModel.findAll({
      where: { tipo: 'SCRAPE' },
      order: [['createdAt', 'DESC']],
      limit: 50,
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
});

scrapeQueue.on('completed', (job, result) => {
  logger.info(`Job ${job.id} completed:`, result);

  const { tipo } = job.data || {};
  if (tipo === 'INITIAL_OAB_CRAWL') {
    void JobModel.findAll({
      where: { tipo: 'SCRAPE' },
      order: [['createdAt', 'DESC']],
      limit: 50,
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
});

/**
 * Adiciona job de scraping na fila
 */
export async function agendarScraping(data: ScrapeJobData): Promise<Job<ScrapeJobData>> {
  const job = await scrapeQueue.add(data, {
    priority: data.prioridade || 2,
    jobId: `${data.tribunalCodigo}-${data.numeroProcesso}`,
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

async function ensureMonitoramentoParaProcesso(processoId: string, advogadoId?: string): Promise<void> {
  if (!advogadoId) {
    return;
  }

  const existingMonitoramento = await Monitoramento.findOne({
    where: { processoId, ativo: true },
  });

  if (existingMonitoramento) {
    return;
  }

  await Monitoramento.create({
    advogadoId,
    processoId,
    intervaloMinutos: 60,
    ativo: true,
  });
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

    const resultadoBusca = await adapter.buscarPorOAB(oab, nome);
    totalEncontrados += resultadoBusca.total;

    for (const processoResumo of resultadoBusca.processos) {
      try {
        const resultado = await TribunalService.buscarESalvarProcesso(
          processoResumo.numeroProcesso,
          tribunalCodigo,
          advogadoId
        );
        totalSalvos += 1;
        await ensureMonitoramentoParaProcesso(resultado.processo.id, advogadoId);
      } catch (error) {
        logger.warn('Falha ao salvar processo durante initial_oab_crawl', {
          tribunalCodigo,
          numeroProcesso: processoResumo.numeroProcesso,
          advogadoId,
          oab,
          correlationId,
          error: (error as Error).message,
        });
      }
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
        jobId: `${item.tribunalCodigo}-${item.numeroProcesso}-${item.tipo || 'PROCESSO'}`,
      },
    }))
  );
  
  logger.info(`Batch de ${items.length} scrapings agendados`);
  
  return jobs;
}

/**
 * Processador de jobs de scraping
 */
scrapeQueue.process(async (job: Job<ScrapeJobData>): Promise<ScrapeJobResult> => {
  const { tipo = 'PROCESSO', numeroProcesso, tribunalCodigo, advogadoId, correlationId } = job.data;
  
  logger.info(`Processando scraping: ${tipo}`, { jobId: job.id, correlationId });
  
  try {
    if (tipo === 'INITIAL_OAB_CRAWL') {
      return processInitialOABCrawl(job);
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
    
    return {
      sucesso: true,
      tipo: 'PROCESSO',
      processoId: resultado.processo.id,
      novasMovimentacoes: resultado.novasMovimentacoes,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error(`Erro no scraping de ${numeroProcesso}:`, error);
    
    return {
      sucesso: false,
      erro: message,
    };
  }
});

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
