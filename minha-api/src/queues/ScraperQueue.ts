/**
 * Sistema de Filas para Scraping de Processos
 * Usa Bull + Redis para processamento assíncrono
 */

import Bull, { Queue, Job } from 'bull';
import { registry } from '../tribunais';
import TribunalService from '../services/TribunalService';
import logger from '../config/logger';

// Configuração da fila
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export interface ScrapeJobData {
  numeroProcesso: string;
  tribunalCodigo: string;
  advogadoId?: string;
  processoId?: string; // Se já existir no banco
  prioridade?: number;
}

export interface ScrapeJobResult {
  sucesso: boolean;
  processoId?: string;
  novasMovimentacoes?: number;
  erro?: string;
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
});

scrapeQueue.on('completed', (job, result) => {
  logger.info(`Job ${job.id} completed:`, result);
});

/**
 * Adiciona job de scraping na fila
 */
export async function agendarScraping(data: ScrapeJobData): Promise<Job<ScrapeJobData>> {
  const job = await scrapeQueue.add(data, {
    priority: data.prioridade || 2,
    jobId: `${data.tribunalCodigo}-${data.numeroProcesso}-${Date.now()}`,
  });
  
  logger.info(`Scraping agendado: ${data.numeroProcesso} em ${data.tribunalCodigo}`, { jobId: job.id });
  
  return job;
}

/**
 * Adiciona múltiplos jobs de scraping (batch)
 */
export async function agendarScrapingBatch(
  items: ScrapeJobData[]
): Promise<Job<ScrapeJobData>[]> {
  const jobs = await scrapeQueue.addBulk(
    items.map((item, index) => ({
      data: item,
      opts: {
        priority: item.prioridade || 2,
        jobId: `${item.tribunalCodigo}-${item.numeroProcesso}-${Date.now()}-${index}`,
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
  const { numeroProcesso, tribunalCodigo, advogadoId, processoId } = job.data;
  
  logger.info(`Processando scraping: ${numeroProcesso}`, { jobId: job.id });
  
  try {
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
      processoId: resultado.processo.id,
      novasMovimentacoes: resultado.novasMovimentacoes,
    };
  } catch (error: any) {
    logger.error(`Erro no scraping de ${numeroProcesso}:`, error);
    
    return {
      sucesso: false,
      erro: error.message,
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
