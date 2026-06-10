import { Router, Request, Response } from 'express';
import { Op } from 'sequelize';
import { sequelize } from '../models';
import '../models';
import Advogado from '../models/Advogado';
import Tribunal from '../models/Tribunal';
import Processo from '../models/Processo';
import Monitoramento from '../models/Monitoramento';
import Movimentacao from '../models/Movimentacao';
import Parte from '../models/Parte';
import Job from '../models/Job';
import Notification from '../models/Notification';
import TribunalService, { ProcessOwnershipConflictError } from '../services/TribunalService';
import FirecrawlEnrichmentService from '../services/FirecrawlEnrichmentService';
import { agendarFirecrawlEnrichment, agendarOABCrawl } from '../queues/ScraperQueue';
import { authRouter } from './auth';
import { authMiddleware, requireRole } from '../middleware/auth';
import { accountRateLimitMiddleware } from '../middleware/accountRateLimit';
import { usageAuditMiddleware } from '../middleware/usageAudit';
import { cache, CACHE_TTL, CACHE_KEYS } from '../config/redis';
import logger from '../config/logger';
import {
  DEFAULT_PROCESS_MONITORING_INTERVAL_MINUTES,
  normalizeProcessMonitoringInterval,
} from '../config/monitoring';
import { expandirTribunaisPorOAB } from '../utils/derivarTribunaisPorOAB';
import {
  getActorAdvogadoId as getActorAdvogadoIdFromPayload,
  isElevatedRole as isElevatedRoleByRole,
  resolveScopedAdvogadoIdForActor,
} from '../utils/tenantScope';

const router = Router();

const getRequestId = (req: Request): string | undefined => {
  const withRequestId = req as Request & { requestId?: string };
  return withRequestId.requestId;
};

const isElevatedRole = (req: Request): boolean =>
  isElevatedRoleByRole(req.user?.role);

const getActorAdvogadoId = (req: Request): string | null =>
  getActorAdvogadoIdFromPayload(req.user);

const resolveScopedAdvogadoId = (
  req: Request,
  requestedAdvogadoId?: string | null
): { ok: true; advogadoId?: string } | { ok: false; status: number; body: unknown } => {
  return resolveScopedAdvogadoIdForActor(req.user, requestedAdvogadoId);
};

const ensureProcessAccess = async (req: Request, processoId: string): Promise<{
  status?: number;
  body?: unknown;
  processo?: Processo;
}> => {
  const processo = await Processo.findByPk(processoId);
  if (!processo) {
    return {
      status: 404,
      body: { erro: { codigo: 'PROCESSO_NAO_ENCONTRADO', mensagem: 'Processo nÃ£o encontrado.' } },
    };
  }

  if (!isElevatedRole(req)) {
    const actorAdvogadoId = getActorAdvogadoId(req);
    if (!actorAdvogadoId || processo.advogadoId !== actorAdvogadoId) {
      return {
        status: 403,
        body: { erro: { codigo: 'FORBIDDEN', mensagem: 'Acesso negado ao processo solicitado.' } },
      };
    }
  }

  return { processo };
};

type BuscaOABStatus = 'success' | 'empty' | 'captcha' | 'requires-auth' | 'blocked' | 'source_unavailable';

const ALL_TRIBUNALS_CODES = new Set(['TODOS', 'ALL', 'NACIONAL', 'BRASIL']);

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const buildAcaoRequerida = (fonte?: {
  fonte: string;
  status: string;
  tribunalCodigo: string;
  url?: string;
  mensagem?: string;
}) => {
  if (!fonte) return undefined;

  if (fonte.status === 'captcha') {
    return {
      tipo: 'captcha',
      titulo: 'Captcha requerido pelo tribunal',
      mensagem: fonte.mensagem || 'O portal oficial exige resoluÃ§Ã£o manual de captcha para continuar.',
      fonte: fonte.fonte,
      tribunalCodigo: fonte.tribunalCodigo,
      url: fonte.url,
      proximosPassos: [
        'Abrir o portal oficial indicado.',
        'Resolver o captcha manualmente ou acessar com sessÃ£o autorizada.',
        'Reexecutar a captura apÃ³s liberar a consulta pÃºblica.',
      ],
    };
  }

  if (fonte.status === 'requires-auth') {
    return {
      tipo: 'credencial',
      titulo: 'Credencial ou certificado requerido',
      mensagem: fonte.mensagem || 'O portal oficial exige login, certificado digital ou convÃªnio para consulta por OAB.',
      fonte: fonte.fonte,
      tribunalCodigo: fonte.tribunalCodigo,
      url: fonte.url,
      proximosPassos: [
        'Usar credenciais/certificado do advogado com consentimento.',
        'Verificar se existe API, MNI ou convÃªnio oficial para o tribunal.',
        'Reexecutar a captura com acesso autenticado quando disponÃ­vel.',
      ],
    };
  }

  if (fonte.status === 'blocked' || fonte.status === 'source_unavailable') {
    return {
      tipo: 'source_unavailable',
      titulo: 'Fonte pÃºblica indisponÃ­vel para automaÃ§Ã£o',
      mensagem: fonte.mensagem || 'O portal oficial bloqueou a consulta automatizada.',
      fonte: fonte.fonte,
      tribunalCodigo: fonte.tribunalCodigo,
      url: fonte.url,
      proximosPassos: [
        'Consultar fonte oficial alternativa.',
        'Usar importaÃ§Ã£o individual por nÃºmero CNJ quando disponÃ­vel.',
        'Registrar necessidade de integraÃ§Ã£o formal com o tribunal.',
      ],
    };
  }

  return undefined;
};

const logRouteError = (req: Request, route: string, error: unknown) => {
  const err = error as {
    name?: string;
    message?: string;
    stack?: string;
    original?: { code?: string; message?: string };
    code?: string;
  };

  logger.error('Route failure', {
    route,
    method: req.method,
    requestId: getRequestId(req),
    errorName: err?.name,
    errorMessage: err?.message,
    dbCode: err?.original?.code ?? err?.code,
    dbMessage: err?.original?.message,
    stack: err?.stack,
  });
};

// Rotas de autenticaÃ§Ã£o (pÃºblicas)
router.use('/auth', authRouter);

// Todas as demais rotas exigem JWT
router.use(authMiddleware);
router.use(accountRateLimitMiddleware);
router.use(usageAuditMiddleware);

// ==================== ROTAS PROTEGIDAS ====================

router.get('/dashboard/movimentacoes', async (req: Request, res: Response) => {
  try {
    const { dias = 7 } = req.query;
    const scoped = resolveScopedAdvogadoId(req);
    if (!scoped.ok) {
      return res.status(scoped.status).json(scoped.body);
    }
    const whereProcesso = scoped.advogadoId ? { advogadoId: scoped.advogadoId } : undefined;

    const agora = new Date();
    const inicio = new Date(agora);
    inicio.setDate(inicio.getDate() - Number(dias));

    type MovimentacaoAgg = { data: string; count: number };
    const movimentacoes = await Movimentacao.findAll({
      where: {
        createdAt: {
          [Op.gte]: inicio,
        },
      },
      attributes: [
        [sequelize.fn('DATE', sequelize.col('created_at')), 'data'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      ],
      group: [sequelize.fn('DATE', sequelize.col('created_at'))],
      order: [[sequelize.fn('DATE', sequelize.col('created_at')), 'ASC']],
      include: whereProcesso ? [{ model: Processo, as: 'processo', where: whereProcesso, attributes: [] }] : [],
      raw: true,
    }) as unknown as MovimentacaoAgg[];

    const resultado: { data: string; count: number }[] = [];
    for (let i = 0; i < Number(dias); i++) {
      const d = new Date(inicio);
      d.setDate(d.getDate() + i);
      const dataStr = d.toISOString().split('T')[0];
      const encontrado = movimentacoes.find((m) => m.data === dataStr);
      resultado.push({ data: dataStr, count: encontrado ? Number(encontrado.count) : 0 });
    }

    res.json({ movimentacoes: resultado });
  } catch (error) {
    logRouteError(req, 'GET /dashboard/movimentacoes', error);
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar movimentaÃ§Ãµes.' } });
  }
});

router.get('/tribunais/batch-status', requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const { codigos } = req.query;
    const listaCodigos = codigos ? (codigos as string).split(',') : [];

    if (listaCodigos.length === 0) {
      return res.status(400).json({
        erro: { codigo: 'VALIDATION_ERROR', mensagem: 'Informe os cÃ³digos dos tribunais.' }
      });
    }

    const { registry } = await import('../tribunais');
    const results = await Promise.allSettled(
      listaCodigos.map(async (codigo: string) => {
        const adapter = registry.get(codigo.toUpperCase());
        if (!adapter) return { codigo, status: 'UNKNOWN', tempo: null };
        const start = Date.now();
        try {
          const healthy = await adapter.healthCheck();
          return { codigo, status: healthy ? 'ONLINE' : 'OFFLINE', tempo: Date.now() - start };
        } catch {
          return { codigo, status: 'OFFLINE', tempo: Date.now() - start };
        }
      })
    );

    const tribunais = results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return { codigo: listaCodigos[i], status: 'UNKNOWN', tempo: null };
    });

    res.json({ tribunais });
  } catch {
    res.status(500).json({ erro: { codigo: 'BATCH_STATUS_ERROR', mensagem: 'Erro ao verificar status.' } });
  }
});

// ==================== ADVOGADOS ====================

router.get('/advogados', async (req: Request, res: Response) => {
  try {
    const scoped = resolveScopedAdvogadoId(req);
    if (!scoped.ok) {
      return res.status(scoped.status).json(scoped.body);
    }

    const advogados = await Advogado.findAll({
      where: {
        ativo: true,
        ...(scoped.advogadoId ? { id: scoped.advogadoId } : {}),
      },
      order: [['nome', 'ASC']],
    });
    res.json({ advogados });
  } catch (error) {
    logRouteError(req, 'GET /advogados', error);
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar advogados.' } });
  }
});

router.get('/advogados/:id', async (req: Request, res: Response) => {
  try {
    const scoped = resolveScopedAdvogadoId(req, req.params.id);
    if (!scoped.ok) {
      return res.status(scoped.status).json(scoped.body);
    }
    const advogado = await Advogado.findByPk(req.params.id);
    if (!advogado) {
      return res.status(404).json({ erro: { codigo: 'ADVOGADO_NAO_ENCONTRADO', mensagem: 'Advogado nÃ£o encontrado.' } });
    }
    res.json({ advogado });
  } catch {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar advogado.' } });
  }
});

router.post('/advogados', async (req: Request, res: Response) => {
  try {
    if (!isElevatedRole(req)) {
      return res.status(403).json({ erro: { codigo: 'FORBIDDEN', mensagem: 'Apenas ADMIN pode criar advogados por esta rota.' } });
    }

    const { oab, nome, email, skipOnboarding } = req.body;
    
    if (!oab || !nome) {
      return res.status(400).json({ erro: { codigo: 'VALIDATION_ERROR', mensagem: 'OAB e nome sÃ£o obrigatÃ³rios.' } });
    }
    
    const existingAdvogado = await Advogado.findOne({ where: { oab } });
    if (existingAdvogado) {
      return res.status(409).json({ erro: { codigo: 'DUPLICATE_OAB', mensagem: 'JÃ¡ existe advogado com esta OAB.' } });
    }
    
    const advogado = await Advogado.create({ oab, nome, email });

    if (skipOnboarding !== true) {
      // Onboarding Ã© assÃ­ncrono e nÃ£o deve bloquear a criaÃ§Ã£o do advogado
      import('../services/AdvogadoOnboardingService')
        .then(({ default: AdvogadoOnboardingService }) => {
          AdvogadoOnboardingService.start({
            advogadoId: advogado.id,
            oab: advogado.oab,
            nome: advogado.nome,
            source: 'admin-create',
            requestedBy: 'admin',
          }).catch((err) => {
            console.error('Onboarding falhou:', err);
          });
        })
        .catch((err) => {
          console.error('ServiÃ§o de onboarding indisponÃ­vel:', err);
        });
    }

    res.status(201).json({ advogado });
  } catch (error) {
    logRouteError(req, 'POST /advogados', error);
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao criar advogado.' } });
  }
});

router.get('/advogados/:id/onboarding-status', async (req: Request, res: Response) => {
  try {
    const scoped = resolveScopedAdvogadoId(req, req.params.id);
    if (!scoped.ok) {
      return res.status(scoped.status).json(scoped.body);
    }

    const advogado = await Advogado.findByPk(req.params.id);
    if (!advogado) {
      return res.status(404).json({ erro: { codigo: 'ADVOGADO_NAO_ENCONTRADO', mensagem: 'Advogado nÃ£o encontrado.' } });
    }

    const { default: AdvogadoOnboardingService } = await import('../services/AdvogadoOnboardingService');
    const status = await AdvogadoOnboardingService.getStatusByAdvogadoId(advogado.id);
    res.json({ status });
  } catch {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao criar advogado.' } });
  }
});

router.put('/advogados/:id', async (req: Request, res: Response) => {
  try {
    const scoped = resolveScopedAdvogadoId(req, req.params.id);
    if (!scoped.ok) {
      return res.status(scoped.status).json(scoped.body);
    }

    const advogado = await Advogado.findByPk(req.params.id);
    if (!advogado) {
      return res.status(404).json({ erro: { codigo: 'ADVOGADO_NAO_ENCONTRADO', mensagem: 'Advogado nÃ£o encontrado.' } });
    }
    
    const updateData: { nome?: string; email?: string; ativo?: boolean } = {
      nome: req.body.nome,
      email: req.body.email,
    };
    if (isElevatedRole(req) && typeof req.body.ativo === 'boolean') {
      updateData.ativo = req.body.ativo;
    }
    await advogado.update(updateData);
    
    res.json({ advogado });
  } catch {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao atualizar advogado.' } });
  }
});

router.delete('/advogados/:id', async (req: Request, res: Response) => {
  try {
    if (!isElevatedRole(req)) {
      return res.status(403).json({ erro: { codigo: 'FORBIDDEN', mensagem: 'Apenas ADMIN pode desativar advogados.' } });
    }

    const advogado = await Advogado.findByPk(req.params.id);
    if (!advogado) {
      return res.status(404).json({ erro: { codigo: 'ADVOGADO_NAO_ENCONTRADO', mensagem: 'Advogado nÃ£o encontrado.' } });
    }
    
    await advogado.update({ ativo: false });
    res.json({ mensagem: 'Advogado desativado com sucesso.' });
  } catch {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao desativar advogado.' } });
  }
});

// ==================== PROCESSOS ====================

router.get('/processos', async (req: Request, res: Response) => {
  try {
    const { advogadoId, tribunalId, status, pagina = 1, limite = 50 } = req.query;
    const scoped = resolveScopedAdvogadoId(req, typeof advogadoId === 'string' ? advogadoId : undefined);
    if (!scoped.ok) {
      return res.status(scoped.status).json(scoped.body);
    }
    
    const where: Record<string, unknown> = {};
    if (scoped.advogadoId) where.advogadoId = scoped.advogadoId;
    if (tribunalId) where.tribunalId = tribunalId;
    if (status) where.status = status;
    
    const offset = (Number(pagina) - 1) * Number(limite);
    
    const { count, rows: processos } = await Processo.findAndCountAll({
      where,
      include: [
        { model: Advogado, as: 'advogado' },
        { model: Tribunal, as: 'tribunal' },
      ],
      order: [['updatedAt', 'DESC']],
      limit: Number(limite),
      offset,
    });
    
    res.json({
      processos,
      pagination: {
        pagina: Number(pagina),
        limite: Number(limite),
        total: count,
        paginas: Math.ceil(count / Number(limite)),
      },
    });
  } catch (error) {
    logRouteError(req, 'GET /processos', error);
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar processos.' } });
  }
});

router.get('/processos/:id', async (req: Request, res: Response) => {
  try {
    const access = await ensureProcessAccess(req, req.params.id);
    if (access.status) {
      return res.status(access.status).json(access.body);
    }

    const processo = await Processo.findByPk(req.params.id, {
      include: [
        { model: Advogado, as: 'advogado' },
        { model: Tribunal, as: 'tribunal' },
        { model: Parte, as: 'partes' },
        { model: Monitoramento, as: 'monitoramentos' },
      ],
    });
    
    if (!processo) {
      return res.status(404).json({ erro: { codigo: 'PROCESSO_NAO_ENCONTRADO', mensagem: 'Processo nÃ£o encontrado.' } });
    }
    
    res.json({ processo });
  } catch {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar processo.' } });
  }
});

router.get('/processos/:id/enriquecimento/firecrawl', async (req: Request, res: Response) => {
  try {
    const access = await ensureProcessAccess(req, req.params.id);
    if (access.status) {
      return res.status(access.status).json(access.body);
    }
    const processo = access.processo!;

    if (!processo) {
      return res.status(404).json({ erro: { codigo: 'PROCESSO_NAO_ENCONTRADO', mensagem: 'Processo nÃ£o encontrado.' } });
    }

    const dadosOriginais = (processo.dadosOriginais ?? {}) as Record<string, unknown>;
    res.json({
      processoId: processo.id,
      numeroProcesso: processo.numeroProcesso,
      firecrawlAux: dadosOriginais.firecrawlAux ?? null,
    });
  } catch (error) {
    logRouteError(req, 'GET /processos/:id/enriquecimento/firecrawl', error);
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar enriquecimento Firecrawl.' } });
  }
});

router.post('/processos/:id/enriquecimento/firecrawl', async (req: Request, res: Response) => {
  let auditJob: Job | undefined;

  try {
    if (!FirecrawlEnrichmentService.isEnabled()) {
      return res.status(503).json({
        erro: {
          codigo: 'FIRECRAWL_DISABLED',
          mensagem: 'Firecrawl estÃ¡ desativado. Defina FIRECRAWL_ENABLED=true para usar enriquecimento auxiliar.',
        },
      });
    }

    if (!FirecrawlEnrichmentService.isReady()) {
      return res.status(503).json({
        erro: {
          codigo: 'FIRECRAWL_NOT_CONFIGURED',
          mensagem: 'Configure FIRECRAWL_API_KEY antes de usar enriquecimento auxiliar.',
        },
      });
    }

    const access = await ensureProcessAccess(req, req.params.id);
    if (access.status) {
      return res.status(access.status).json(access.body);
    }
    const processo = access.processo!;

    const { urls, forceRefresh, onlyMainContent, requestedBy } = req.body;
    let urlsNormalizadas: string[];

    try {
      urlsNormalizadas = FirecrawlEnrichmentService.validateUrls(urls);
    } catch (error) {
      return res.status(400).json({
        erro: {
          codigo: 'VALIDATION_ERROR',
          mensagem: (error as Error).message,
        },
      });
    }

    const tribunal = processo.tribunalId ? await Tribunal.findByPk(processo.tribunalId) : null;
    const correlationId = `${processo.id}:${Date.now()}`;

    auditJob = await Job.create({
      processoId: processo.id,
      tipo: 'SCRAPE',
      status: 'PENDENTE',
      scheduledAt: new Date(),
      tentativas: 0,
      maxTentativas: 2,
      payload: {
        mode: 'firecrawl_aux',
        processoId: processo.id,
        numeroProcesso: processo.numeroProcesso,
        tribunalCodigo: tribunal?.codigo,
        urls: urlsNormalizadas,
        forceRefresh: forceRefresh === true,
        onlyMainContent: typeof onlyMainContent === 'boolean' ? onlyMainContent : undefined,
        requestedBy: requestedBy || 'api',
        correlationId,
      },
    });

    const queueJob = await agendarFirecrawlEnrichment({
      processoId: processo.id,
      numeroProcesso: processo.numeroProcesso,
      tribunalCodigo: tribunal?.codigo,
      urls: urlsNormalizadas,
      forceRefresh: forceRefresh === true,
      onlyMainContent: typeof onlyMainContent === 'boolean' ? onlyMainContent : undefined,
      requestedBy: requestedBy || 'api',
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

    res.status(202).json({
      sucesso: true,
      status: 'queued',
      processoId: processo.id,
      numeroProcesso: processo.numeroProcesso,
      jobId: String(queueJob.id),
      auditJobId: auditJob.id,
      urls: urlsNormalizadas,
    });
  } catch (error) {
    if (auditJob) {
      await auditJob.update({
        status: 'FALHO',
        erro: (error as Error).message,
        completedAt: new Date(),
      });
    }

    logRouteError(req, 'POST /processos/:id/enriquecimento/firecrawl', error);
    res.status(500).json({ erro: { codigo: 'FIRECRAWL_ENRICHMENT_ERROR', mensagem: 'Erro ao agendar enriquecimento Firecrawl.' } });
  }
});

router.post('/processos', async (req: Request, res: Response) => {
  try {
    const { numeroProcesso, tribunalId, advogadoId, classe, assunto } = req.body;
    const scoped = resolveScopedAdvogadoId(req, advogadoId);
    if (!scoped.ok) {
      return res.status(scoped.status).json(scoped.body);
    }
    
    if (!numeroProcesso || !tribunalId || !scoped.advogadoId) {
      return res.status(400).json({ 
        erro: { 
          codigo: 'VALIDATION_ERROR', 
          mensagem: 'NÃºmero do processo, tribunal e advogado sÃ£o obrigatÃ³rios.' 
        } 
      });
    }
    
    const existingProcesso = await Processo.findOne({ where: { numeroProcesso } });
    if (existingProcesso) {
      return res.status(409).json({ 
        erro: { 
          codigo: 'DUPLICATE_PROCESSO', 
          mensagem: 'Este processo jÃ¡ estÃ¡ cadastrado.' 
        } 
      });
    }
    
    const processo = await Processo.create({ 
      numeroProcesso, 
      tribunalId, 
      advogadoId: scoped.advogadoId, 
      classe, 
      assunto,
      instancia: 'PRIMEIRA',
      status: 'MONITORANDO',
    });
    
    // Create initial monitoramento
    await Monitoramento.create({
      advogadoId: scoped.advogadoId,
      processoId: processo.id,
      intervaloMinutos: DEFAULT_PROCESS_MONITORING_INTERVAL_MINUTES,
      ativo: true,
    });
    
    res.status(201).json({ processo });
  } catch {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao criar processo.' } });
  }
});

router.delete('/processos/:id', async (req: Request, res: Response) => {
  try {
    const access = await ensureProcessAccess(req, req.params.id);
    if (access.status) {
      return res.status(access.status).json(access.body);
    }
    const processo = access.processo!;
    
    await Monitoramento.destroy({ where: { processoId: req.params.id } });
    await processo.destroy();
    
    res.json({ mensagem: 'Processo removido com sucesso.' });
  } catch {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao remover processo.' } });
  }
});

// ==================== MOVIMENTAÃ‡Ã•ES ====================

router.get('/processos/:id/movimentacoes', async (req: Request, res: Response) => {
  try {
    const access = await ensureProcessAccess(req, req.params.id);
    if (access.status) {
      return res.status(access.status).json(access.body);
    }
    const { pagina = 1, limite = 50, data_inicio, data_fim } = req.query;
    
    const where: Record<string, unknown> = { processoId: req.params.id };
    
    if (data_inicio || data_fim) {
      const dataFilter: Record<symbol, Date> = {};
      if (data_inicio) dataFilter[Op.gte] = new Date(data_inicio as string);
      if (data_fim) dataFilter[Op.lte] = new Date(data_fim as string);
      where.data = dataFilter;
    }
    
    const offset = (Number(pagina) - 1) * Number(limite);
    
    const { count, rows: movimentacoes } = await Movimentacao.findAndCountAll({
      where,
      order: [['data', 'DESC']],
      limit: Number(limite),
      offset,
    });
    
    res.json({
      movimentacoes,
      pagination: {
        pagina: Number(pagina),
        limite: Number(limite),
        total: count,
        paginas: Math.ceil(count / Number(limite)),
      },
    });
  } catch {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar movimentaÃ§Ãµes.' } });
  }
});

router.get('/processos/:id/movimentacoes/novas', async (req: Request, res: Response) => {
  try {
    const access = await ensureProcessAccess(req, req.params.id);
    if (access.status) {
      return res.status(access.status).json(access.body);
    }
    const movimentacoes = await Movimentacao.findAll({
      where: { processoId: req.params.id, nova: true },
      order: [['data', 'DESC']],
    });
    
    // Mark as not new
    await Movimentacao.update(
      { nova: false },
      { where: { processoId: req.params.id, nova: true } }
    );
    
    res.json({ movimentacoes });
  } catch {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar movimentaÃ§Ãµes.' } });
  }
});

router.get('/processos/:id/partes', async (req: Request, res: Response) => {
  try {
    const access = await ensureProcessAccess(req, req.params.id);
    if (access.status) {
      return res.status(access.status).json(access.body);
    }
    const partes = await Parte.findAll({
      where: { processoId: req.params.id },
      order: [['tipo', 'ASC'], ['nome', 'ASC']],
    });
    
    res.json({ partes });
  } catch {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar partes.' } });
  }
});

// ==================== MONITORAMENTOS ====================

router.get('/monitoramentos', async (req: Request, res: Response) => {
  try {
    const { advogadoId, ativo } = req.query;
    const scoped = resolveScopedAdvogadoId(req, typeof advogadoId === 'string' ? advogadoId : undefined);
    if (!scoped.ok) {
      return res.status(scoped.status).json(scoped.body);
    }

    const where: Record<string, unknown> = {};
    if (scoped.advogadoId) where.advogadoId = scoped.advogadoId;
    if (ativo !== undefined) where.ativo = ativo === 'true';
    
    const monitoramentos = await Monitoramento.findAll({
      where,
      include: [
        { model: Processo, as: 'processo' },
        { model: Advogado, as: 'advogado' },
      ],
    });
    
    res.json({ monitoramentos });
  } catch {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar monitoramentos.' } });
  }
});

router.post('/processos/:id/monitorar', async (req: Request, res: Response) => {
  try {
    const intervaloMinutos = normalizeProcessMonitoringInterval(req.body?.intervaloMinutos);
    
    const access = await ensureProcessAccess(req, req.params.id);
    if (access.status) {
      return res.status(access.status).json(access.body);
    }
    const processo = access.processo!;
    
    const existingMonitoramento = await Monitoramento.findOne({
      where: { processoId: req.params.id, ativo: true },
    });
    
    if (existingMonitoramento) {
      await existingMonitoramento.update({ intervaloMinutos });
      return res.json({ monitoramento: existingMonitoramento });
    }

    if (!processo.advogadoId) {
      return res.status(400).json({
        erro: { codigo: 'ADVOGADO_NAO_ASSOCIADO', mensagem: 'Processo nÃ£o tem advogado associado.' }
      });
    }

    const monitoramento = await Monitoramento.create({
      advogadoId: processo.advogadoId,
      processoId: processo.id,
      intervaloMinutos,
      ativo: true,
    });
    
    res.status(201).json({ monitoramento });
  } catch {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao criar monitoramento.' } });
  }
});

router.delete('/processos/:id/monitorar', async (req: Request, res: Response) => {
  try {
    const access = await ensureProcessAccess(req, req.params.id);
    if (access.status) {
      return res.status(access.status).json(access.body);
    }

    const monitoramento = await Monitoramento.findOne({
      where: { processoId: req.params.id, ativo: true },
    });
    
    if (!monitoramento) {
      return res.status(404).json({ erro: { codigo: 'MONITORAMENTO_NAO_ENCONTRADO', mensagem: 'Monitoramento nÃ£o encontrado.' } });
    }
    
    await monitoramento.update({ ativo: false });
    res.json({ mensagem: 'Monitoramento desativado com sucesso.' });
  } catch {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao desativar monitoramento.' } });
  }
});

// ==================== TRIBUNAIS ====================

router.get('/tribunais', async (req: Request, res: Response) => {
  try {
    const cacheKey = CACHE_KEYS.TRIBUNAL_STATUS;

    // Try cache first
    const cached = await cache.get(cacheKey);
    if (cached) {
      res.locals.cacheHit = true;
      return res.json({ tribunais: JSON.parse(cached), cached: true });
    }

    const tribunais = await Tribunal.findAll({
      where: { ativo: true },
      order: [['nome', 'ASC']],
    });

    // Cache the result
    await cache.set(cacheKey, JSON.stringify(tribunais), CACHE_TTL.TRIBUNAL_STATUS);
    res.locals.cacheHit = false;

    res.set('Cache-Control', 'public, max-age=300');
    res.json({ tribunais });
  } catch (error) {
    logRouteError(req, 'GET /tribunais', error);
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar tribunais.' } });
  }
});

// ==================== TRIBUNAIS - INTEGRAÃ‡ÃƒO ====================

router.post('/tribunais/:codigo/buscar', async (req: Request, res: Response) => {
  try {
    const { codigo } = req.params;
    const { numeroProcesso, advogadoId } = req.body;
    const scoped = resolveScopedAdvogadoId(req, advogadoId);
    if (!scoped.ok) {
      return res.status(scoped.status).json(scoped.body);
    }
    
    if (!numeroProcesso) {
      return res.status(400).json({
        erro: { codigo: 'VALIDATION_ERROR', mensagem: 'NÃºmero do processo Ã© obrigatÃ³rio.' }
      });
    }
    
    const resultado = await TribunalService.buscarESalvarProcesso(
      numeroProcesso,
      codigo.toUpperCase(),
      scoped.advogadoId
    );
    
    res.json({
      sucesso: true,
      processo: resultado.processo,
      ehNovo: resultado.ehNovo,
      totalMovimentacoes: resultado.totalMovimentacoes,
      novasMovimentacoes: resultado.novasMovimentacoes,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    if (error instanceof ProcessOwnershipConflictError) {
      return res.status(403).json({ erro: { codigo: 'PROCESSO_OWNERSHIP_CONFLICT', mensagem: message } });
    }
    if (message.includes('nÃ£o suportado') || message.includes('nÃ£o encontrado')) {
      return res.status(400).json({ erro: { codigo: 'TRIBUNAL_ERROR', mensagem: message } });
    }
    res.status(500).json({ erro: { codigo: 'SCRAPE_ERROR', mensagem: 'Erro ao buscar processo.' } });
  }
});

router.post('/tribunais/:codigo/buscar-oab', async (req: Request, res: Response) => {
  try {
    const { codigo } = req.params;
    const { oab, nome, advogadoId, forceRefresh, limiteProcessos, onlyMissing } = req.body;
    const scoped = resolveScopedAdvogadoId(req, advogadoId);
    if (!scoped.ok) {
      return res.status(scoped.status).json(scoped.body);
    }

    if (!oab) {
      return res.status(400).json({
        erro: { codigo: 'VALIDATION_ERROR', mensagem: 'OAB Ã© obrigatÃ³ria.' }
      });
    }

    // Valida tribunal
    const { registry } = await import('../tribunais');
    const adapter = registry.get(codigo.toUpperCase());

    if (!adapter) {
      return res.status(400).json({
        erro: { codigo: 'TRIBUNAL_NOT_SUPPORTED', mensagem: `Tribunal nÃ£o suportado: ${codigo}` }
      });
    }

    // Usa cache - busca no tribunal apenas se necessario
    const resultado = await TribunalService.buscarPorOABComCache(
      oab,
      codigo.toUpperCase(),
      nome,
      scoped.advogadoId,
      forceRefresh === true,
      typeof limiteProcessos === 'number' ? limiteProcessos : undefined,
      onlyMissing === true
    );

    const fontes = resultado.fontes || [];
    const fonteBloqueante = fontes.find(fonte =>
      ['requires-auth', 'captcha', 'blocked', 'source_unavailable'].includes(fonte.status)
    );
    const status: BuscaOABStatus = resultado.processos.length > 0
      ? 'success'
      : ((fonteBloqueante?.status as BuscaOABStatus | undefined) || 'empty');
    const acaoRequerida = buildAcaoRequerida(fonteBloqueante);

    res.locals.cacheHit = resultado.doCache;
    res.locals.resultStatus = status;

    res.json({
      sucesso: true,
      status,
      totalEncontrados: resultado.processos.length,
      processos: resultado.processos,
      doCache: resultado.doCache,
      tempoMs: resultado.tempoMs,
      fontes,
      motivo: fonteBloqueante?.mensagem,
      acaoRequerida,
    });
  } catch (error) {
    logger.error(`Erro ao buscar OAB: ${getErrorMessage(error)}`);
    res.status(500).json({ erro: { codigo: 'SCRAPE_ERROR', mensagem: 'Erro ao buscar por OAB.' } });
  }
});

router.post('/tribunais/:codigo/buscar-oab/async', async (req: Request, res: Response) => {
  let auditJob: Job | undefined;

  try {
    const { codigo } = req.params;
    const { oab, nome, advogadoId, requestedBy } = req.body;
    const scoped = resolveScopedAdvogadoId(req, advogadoId);
    if (!scoped.ok) {
      return res.status(scoped.status).json(scoped.body);
    }
    const scopedAdvogadoId = scoped.advogadoId;
    const tribunalCodigo = codigo.toUpperCase();
    const buscaNacional = ALL_TRIBUNALS_CODES.has(tribunalCodigo);

    if (!oab || !scopedAdvogadoId) {
      return res.status(400).json({
        erro: {
          codigo: 'VALIDATION_ERROR',
          mensagem: 'OAB e advogadoId sÃ£o obrigatÃ³rios para busca assÃ­ncrona.',
        },
      });
    }

    const oabNormalizada = String(oab).toUpperCase().replace(/\s/g, '');
    const { registry } = await import('../tribunais');
    const tribunaisRegistrados = registry
      .listar()
      .map((tribunal) => tribunal.codigo.toUpperCase());
    const tribunaisDisponiveis = new Set(tribunaisRegistrados);
    const tribunaisSolicitados = buscaNacional
      ? tribunaisRegistrados
      : expandirTribunaisPorOAB(tribunalCodigo, oabNormalizada);
    const tribunaisAlvo = Array.from(
      new Set(tribunaisSolicitados.map((codigoTribunal) => codigoTribunal.toUpperCase()))
    ).filter((codigoTribunal) => tribunaisDisponiveis.has(codigoTribunal));

    if (!buscaNacional && !tribunaisDisponiveis.has(tribunalCodigo)) {
      return res.status(400).json({
        erro: { codigo: 'TRIBUNAL_NOT_SUPPORTED', mensagem: `Tribunal nÃ£o suportado: ${codigo}` },
      });
    }

    const advogado = await Advogado.findByPk(scopedAdvogadoId);
    if (!advogado) {
      return res.status(404).json({
        erro: { codigo: 'ADVOGADO_NAO_ENCONTRADO', mensagem: 'Advogado nÃ£o encontrado.' },
      });
    }

    const correlationId = `${scopedAdvogadoId}:${buscaNacional ? 'TODOS' : tribunalCodigo}:${Date.now()}`;

    auditJob = await Job.create({
      tipo: 'SCRAPE',
      status: 'PENDENTE',
      scheduledAt: new Date(),
      tentativas: 0,
      maxTentativas: 3,
      payload: {
        mode: 'oab_crawl',
        advogadoId: scopedAdvogadoId,
        oab: oabNormalizada,
        nome,
        tribunalCodigo: buscaNacional ? 'TODOS' : tribunalCodigo,
        tribunais: tribunaisAlvo,
        requestedBy: requestedBy || 'manual-oab-search',
        correlationId,
      },
    });

    const queueJob = await agendarOABCrawl({
      advogadoId: scopedAdvogadoId,
      oab: oabNormalizada,
      nome,
      tribunais: tribunaisAlvo,
      prioridade: 1,
      requestedBy: requestedBy || 'manual-oab-search',
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

    res.status(202).json({
      sucesso: true,
      status: 'queued',
      jobId: auditJob.id,
      queueJobId: String(queueJob.id),
      tribunais: tribunaisAlvo,
      totalTribunais: tribunaisAlvo.length,
      mensagem: buscaNacional
        ? `Busca nacional por OAB agendada em ${tribunaisAlvo.length} tribunais. Os processos serÃ£o salvos em background.`
        : 'Busca por OAB agendada. Os processos serÃ£o salvos em background.',
    });
  } catch (error) {
    const message = getErrorMessage(error);
    if (auditJob) {
      await auditJob.update({
        status: 'FALHO',
        erro: message,
        completedAt: new Date(),
      });
    }

    logRouteError(req, 'POST /tribunais/:codigo/buscar-oab/async', error);
    res.status(500).json({ erro: { codigo: 'OAB_ASYNC_ERROR', mensagem: 'Erro ao agendar busca por OAB.' } });
  }
});

router.post('/tribunais/:codigo/processos/:numero/refresh', async (req: Request, res: Response) => {
  try {
    const { numero } = req.params;
    
    const processo = await Processo.findOne({
      where: { numeroProcesso: numero },
      include: [{ model: Tribunal, as: 'tribunal' }],
    });
    
    if (!processo) {
      return res.status(404).json({
        erro: { codigo: 'PROCESSO_NAO_ENCONTRADO', mensagem: 'Processo nÃ£o encontrado.' }
      });
    }
    if (!isElevatedRole(req)) {
      const actorAdvogadoId = getActorAdvogadoId(req);
      if (!actorAdvogadoId || processo.advogadoId !== actorAdvogadoId) {
        return res.status(403).json({
          erro: { codigo: 'FORBIDDEN', mensagem: 'Acesso negado ao processo solicitado.' },
        });
      }
    }
    
    const resultado = await TribunalService.atualizarProcesso(processo.id);
    
    res.json({
      sucesso: true,
      processo: resultado.processo,
      novasMovimentacoes: resultado.novasMovimentacoes,
    });
  } catch {
    res.status(500).json({ erro: { codigo: 'REFRESH_ERROR', mensagem: 'Erro ao atualizar processo.' } });
  }
});

router.get('/tribunais/:codigo/status', async (req: Request, res: Response) => {
  try {
    const { codigo } = req.params;
    
    const { registry } = await import('../tribunais');
    const adapter = registry.get(codigo.toUpperCase());
    
    if (!adapter) {
      return res.status(400).json({
        erro: { codigo: 'TRIBUNAL_NOT_SUPPORTED', mensagem: `Tribunal nÃ£o suportado: ${codigo}` }
      });
    }
    
    const healthy = await adapter.healthCheck();
    
    res.json({
      codigo: adapter.codigo,
      usaCaptcha: adapter.usaCaptcha,
      status: healthy ? 'ONLINE' : 'OFFLINE',
    });
  } catch {
    res.status(500).json({ erro: { codigo: 'STATUS_ERROR', mensagem: 'Erro ao verificar status.' } });
  }
});

// ==================== JOBS ====================

router.get('/jobs', requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const { status, tipo, limite = 50 } = req.query;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (tipo) where.tipo = tipo;

    const jobs = await Job.findAll({
      where,
      include: [{ model: Processo, as: 'processo' }],
      order: [['createdAt', 'DESC']],
      limit: Number(limite),
    });

    res.json({ jobs });
  } catch (error) {
    logRouteError(req, 'GET /jobs', error);
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar jobs.' } });
  }
});

router.get('/jobs/:id', requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const job = await Job.findByPk(req.params.id, {
      include: [{ model: Processo, as: 'processo' }],
    });

    if (!job) {
      return res.status(404).json({ erro: { codigo: 'JOB_NOT_FOUND', mensagem: 'Job nÃ£o encontrado.' } });
    }

    res.json({ job });
  } catch {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar job.' } });
  }
});

router.post('/jobs/:id/retry', requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const job = await Job.findByPk(req.params.id);

    if (!job) {
      return res.status(404).json({ erro: { codigo: 'JOB_NOT_FOUND', mensagem: 'Job nÃ£o encontrado.' } });
    }

    await job.update({ status: 'PENDENTE', tentativas: 0, erro: undefined });

    res.json({ job });
  } catch {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao retry job.' } });
  }
});

// ==================== NOTIFICATIONS ====================

router.get('/notifications', async (req: Request, res: Response) => {
  try {
    const { advogadoId, lida, limite = 50 } = req.query;
    const scoped = resolveScopedAdvogadoId(req, typeof advogadoId === 'string' ? advogadoId : undefined);
    if (!scoped.ok) {
      return res.status(scoped.status).json(scoped.body);
    }

    const where: Record<string, unknown> = {};
    if (scoped.advogadoId) where.advogadoId = scoped.advogadoId;
    if (lida !== undefined) where.lida = lida === 'true';

    const notifications = await Notification.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: Number(limite),
    });

    res.json({ notifications });
  } catch {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar notifications.' } });
  }
});

router.put('/notifications/:id/read', async (req: Request, res: Response) => {
  try {
    const notification = await Notification.findByPk(req.params.id);

    if (!notification) {
      return res.status(404).json({ erro: { codigo: 'NOTIFICATION_NOT_FOUND', mensagem: 'NotificaÃ§Ã£o nÃ£o encontrada.' } });
    }
    if (!isElevatedRole(req)) {
      const actorAdvogadoId = getActorAdvogadoId(req);
      if (!actorAdvogadoId || notification.advogadoId !== actorAdvogadoId) {
        return res.status(403).json({ erro: { codigo: 'FORBIDDEN', mensagem: 'Acesso negado à notificação.' } });
      }
    }

    await notification.update({ lida: true });
    res.json({ notification });
  } catch {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao marcar notification.' } });
  }
});

router.put('/notifications/read-all', async (req: Request, res: Response) => {
  try {
    const { advogadoId } = req.query;
    const scoped = resolveScopedAdvogadoId(req, typeof advogadoId === 'string' ? advogadoId : undefined);
    if (!scoped.ok) {
      return res.status(scoped.status).json(scoped.body);
    }

    const where: Record<string, unknown> = { lida: false };
    if (scoped.advogadoId) where.advogadoId = scoped.advogadoId;

    await Notification.update({ lida: true }, { where });
    res.json({ mensagem: 'Todas marcadas como lidas.' });
  } catch {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao marcar notifications.' } });
  }
});

// ==================== ADVOGADOS / PROCESSOS ====================

router.get('/advogados/:id/processos', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { tribunalId, status, limite = 50 } = req.query;
    const scoped = resolveScopedAdvogadoId(req, id);
    if (!scoped.ok) {
      return res.status(scoped.status).json(scoped.body);
    }

    const where: Record<string, unknown> = { advogadoId: scoped.advogadoId || id };
    if (tribunalId) where.tribunalId = tribunalId;
    if (status) where.status = status;

    const processos = await Processo.findAll({
      where,
      include: [
        { model: Advogado, as: 'advogado' },
        { model: Tribunal, as: 'tribunal' },
      ],
      order: [['updatedAt', 'DESC']],
      limit: Number(limite),
    });

    res.json({ processos });
  } catch (error) {
    logRouteError(req, 'GET /advogados/:id/processos', error);
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar processos.' } });
  }
});

// ==================== DASHBOARD ====================

router.get('/dashboard/stats', async (req: Request, res: Response) => {
  try {
    const { advogadoId } = req.query;
    const scoped = resolveScopedAdvogadoId(req, typeof advogadoId === 'string' ? advogadoId : undefined);
    if (!scoped.ok) {
      return res.status(scoped.status).json(scoped.body);
    }
    const scopedAdvogadoId = scoped.advogadoId;

    const whereAdv: Record<string, unknown> = { ativo: true };
    if (scopedAdvogadoId) whereAdv.id = scopedAdvogadoId;

    const [totalAdvogados, totalProcessos, jobsPendentes, jobsFalhos, monitoramentosAtivos] = await Promise.all([
      Advogado.count({ where: whereAdv }),
      Processo.count({ where: scopedAdvogadoId ? { advogadoId: scopedAdvogadoId } : {} }),
      scopedAdvogadoId
        ? Job.count({
          where: { status: 'PENDENTE' },
          include: [{ model: Processo, as: 'processo', where: { advogadoId: scopedAdvogadoId }, required: true }],
        })
        : Job.count({ where: { status: 'PENDENTE' } }),
      scopedAdvogadoId
        ? Job.count({
          where: { status: 'FALHO' },
          include: [{ model: Processo, as: 'processo', where: { advogadoId: scopedAdvogadoId }, required: true }],
        })
        : Job.count({ where: { status: 'FALHO' } }),
      Monitoramento.count({ where: scopedAdvogadoId ? { ativo: true, advogadoId: scopedAdvogadoId } : { ativo: true } }),
    ]);

    const totalMovimentacoesHoje = await Movimentacao.count({
      where: {
        createdAt: {
          [Op.gte]: new Date(new Date().setHours(0, 0, 0, 0)),
        },
      },
      include: scopedAdvogadoId ? [{
        model: Processo,
        as: 'processo',
        where: { advogadoId: scopedAdvogadoId },
        attributes: [],
      }] : [],
    });

    res.json({
      totalAdvogados,
      totalProcessos,
      jobsPendentes,
      jobsFalhos,
      monitoramentosAtivos,
      totalMovimentacoesHoje,
    });
  } catch (error) {
    logRouteError(req, 'GET /dashboard/stats', error);
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar estatÃ­sticas.' } });
  }
});

// ==================== ADMIN ====================

router.get('/admin/advogados', requireRole('ADMIN'), async (_req: Request, res: Response) => {
  const advogados = await Advogado.findAll({ order: [['nome', 'ASC']] });
  res.json({ advogados });
});

router.get('/admin/monitoramentos', requireRole('ADMIN'), async (_req: Request, res: Response) => {
  const monitoramentos = await Monitoramento.findAll({
    include: [
      { model: Processo, as: 'processo' },
      { model: Advogado, as: 'advogado' },
    ],
    order: [['updatedAt', 'DESC']],
  });
  res.json({ monitoramentos });
});

router.get('/admin/notifications', requireRole('ADMIN'), async (req: Request, res: Response) => {
  const limite = Number(req.query.limite || 100);
  const notifications = await Notification.findAll({
    order: [['createdAt', 'DESC']],
    limit: limite,
  });
  res.json({ notifications });
});

router.get('/admin/dashboard/stats', requireRole('ADMIN'), async (req: Request, res: Response) => {
  const { advogadoId } = req.query;
  const whereAdv: Record<string, unknown> = { ativo: true };
  if (advogadoId) whereAdv.id = advogadoId;

  const [totalAdvogados, totalProcessos, jobsPendentes, jobsFalhos, monitoramentosAtivos] = await Promise.all([
    Advogado.count({ where: whereAdv }),
    Processo.count({ where: advogadoId ? { advogadoId: String(advogadoId) } : {} }),
    Job.count({ where: { status: 'PENDENTE' } }),
    Job.count({ where: { status: 'FALHO' } }),
    Monitoramento.count({ where: { ativo: true } }),
  ]);

  const totalMovimentacoesHoje = await Movimentacao.count({
    where: { createdAt: { [Op.gte]: new Date(new Date().setHours(0, 0, 0, 0)) } },
  });

  res.json({
    totalAdvogados,
    totalProcessos,
    jobsPendentes,
    jobsFalhos,
    monitoramentosAtivos,
    totalMovimentacoesHoje,
  });
});

export { router };




