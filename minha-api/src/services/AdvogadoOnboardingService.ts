import Job from '../models/Job';
import logger from '../config/logger';
import ProcessoMonitoramentoService from './ProcessoMonitoramentoService';
import { agendarInitialOABCrawl } from '../queues/ScraperQueue';

type OnboardingSource = 'admin-create' | 'self-register';
type OnboardingStatus = 'pending' | 'running' | 'succeeded' | 'failed';

interface StartOnboardingParams {
  advogadoId: string;
  oab: string;
  nome?: string;
  source: OnboardingSource;
  requestedBy?: string;
}

interface OnboardingSnapshot {
  status: OnboardingStatus;
  jobId?: string;
  error?: string;
  updatedAt?: Date;
}

function normalizeOAB(oab: string): string {
  return oab.toUpperCase().replace(/\s/g, '');
}

function mapJobStatus(jobStatus: string): OnboardingStatus {
  if (jobStatus === 'CONCLUIDO') return 'succeeded';
  if (jobStatus === 'FALHO') return 'failed';
  if (jobStatus === 'PROCESSANDO') return 'running';
  return 'pending';
}

class AdvogadoOnboardingService {
  async start(params: StartOnboardingParams): Promise<void> {
    const oab = normalizeOAB(params.oab);
    const correlationId = `${params.advogadoId}:${Date.now()}`;
    const cooldownMs = Number(process.env.INITIAL_OAB_CRAWL_COOLDOWN_MS || 5 * 60 * 1000);

    const recentJobs = await Job.findAll({
      where: { tipo: 'SCRAPE' },
      order: [['createdAt', 'DESC']],
      limit: 30,
    });

    const hasRecentForSameOAB = recentJobs.some((job) => {
      const payload = (job.payload ?? {}) as Record<string, unknown>;
      const payloadOAB = typeof payload.oab === 'string' ? normalizeOAB(payload.oab) : '';
      const mode = payload.mode;
      const createdAt = job.createdAt ? new Date(job.createdAt).getTime() : 0;
      return mode === 'initial_oab_crawl' && payloadOAB === oab && Date.now() - createdAt <= cooldownMs;
    });

    if (hasRecentForSameOAB) {
      logger.warn('Onboarding crawl ignorado por cooldown de OAB', {
        advogadoId: params.advogadoId,
        oab,
        source: params.source,
        cooldownMs,
      });
      return;
    }

    try {
      await ProcessoMonitoramentoService.cadastrarOABMonitorada(oab, undefined, 5);
    } catch (error) {
      logger.warn('Falha ao cadastrar OAB no monitoramento contínuo', {
        advogadoId: params.advogadoId,
        oab,
        source: params.source,
        correlationId,
        error: (error as Error).message,
      });
    }

    const auditJob = await Job.create({
      tipo: 'SCRAPE',
      status: 'PENDENTE',
      scheduledAt: new Date(),
      tentativas: 0,
      maxTentativas: 3,
      payload: {
        mode: 'initial_oab_crawl',
        advogadoId: params.advogadoId,
        oab,
        nome: params.nome,
        source: params.source,
        requestedBy: params.requestedBy,
        correlationId,
      },
    });

    try {
      const queueJob = await agendarInitialOABCrawl({
        advogadoId: params.advogadoId,
        oab,
        nome: params.nome,
        prioridade: 1,
        source: params.source,
        requestedBy: params.requestedBy,
        correlationId,
      });

      await auditJob.update({
        status: 'PROCESSANDO',
        startedAt: new Date(),
        payload: {
          ...(auditJob.payload ?? {}),
          queueJobId: String(queueJob.id),
        },
      });

      logger.info('Onboarding de advogado enfileirado', {
        advogadoId: params.advogadoId,
        oab,
        source: params.source,
        correlationId,
        queueJobId: queueJob.id,
      });
    } catch (error) {
      await auditJob.update({
        status: 'FALHO',
        erro: (error as Error).message,
        completedAt: new Date(),
      });

      logger.error('Falha ao enfileirar onboarding inicial por OAB', {
        advogadoId: params.advogadoId,
        oab,
        source: params.source,
        correlationId,
        error: (error as Error).message,
      });
    }
  }

  async getStatusByAdvogadoId(advogadoId: string): Promise<OnboardingSnapshot> {
    const jobs = await Job.findAll({
      where: { tipo: 'SCRAPE' },
      order: [['createdAt', 'DESC']],
      limit: 50,
    });

    const onboardingJob = jobs.find((job) => {
      const payload = (job.payload ?? {}) as Record<string, unknown>;
      return payload.mode === 'initial_oab_crawl' && payload.advogadoId === advogadoId;
    });

    if (!onboardingJob) {
      return { status: 'pending' };
    }

    const payload = (onboardingJob.payload ?? {}) as Record<string, unknown>;
    const queueJobId = typeof payload.queueJobId === 'string' ? payload.queueJobId : undefined;

    return {
      status: mapJobStatus(onboardingJob.status),
      jobId: queueJobId ?? onboardingJob.id,
      error: onboardingJob.erro ?? undefined,
      updatedAt: onboardingJob.updatedAt,
    };
  }
}

export default new AdvogadoOnboardingService();
