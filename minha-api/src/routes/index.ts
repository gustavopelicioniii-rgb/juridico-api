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
import TribunalService from '../services/TribunalService';
import FirecrawlEnrichmentService from '../services/FirecrawlEnrichmentService';
import { agendarFirecrawlEnrichment, agendarOABCrawl } from '../queues/ScraperQueue';
import { authRouter } from './auth';
import { authMiddleware } from '../middleware/auth';
import { cache, CACHE_TTL, CACHE_KEYS } from '../config/redis';
import logger from '../config/logger';
import {
  DEFAULT_PROCESS_MONITORING_INTERVAL_MINUTES,
  normalizeProcessMonitoringInterval,
} from '../config/monitoring';

const router = Router();

const getRequestId = (req: Request): string | undefined => {
  const withRequestId = req as Request & { requestId?: string };
  return withRequestId.requestId;
};

type BuscaOABStatus = 'success' | 'empty' | 'captcha' | 'requires-auth' | 'blocked';

const ALL_TRIBUNALS_CODES = new Set(['TODOS', 'ALL', 'NACIONAL', 'BRASIL']);

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
      mensagem: fonte.mensagem || 'O portal oficial exige resolução manual de captcha para continuar.',
      fonte: fonte.fonte,
      tribunalCodigo: fonte.tribunalCodigo,
      url: fonte.url,
      proximosPassos: [
        'Abrir o portal oficial indicado.',
        'Resolver o captcha manualmente ou acessar com sessão autorizada.',
        'Reexecutar a captura após liberar a consulta pública.',
      ],
    };
  }

  if (fonte.status === 'requires-auth') {
    return {
      tipo: 'credencial',
      titulo: 'Credencial ou certificado requerido',
      mensagem: fonte.mensagem || 'O portal oficial exige login, certificado digital ou convênio para consulta por OAB.',
      fonte: fonte.fonte,
      tribunalCodigo: fonte.tribunalCodigo,
      url: fonte.url,
      proximosPassos: [
        'Usar credenciais/certificado do advogado com consentimento.',
        'Verificar se existe API, MNI ou convênio oficial para o tribunal.',
        'Reexecutar a captura com acesso autenticado quando disponível.',
      ],
    };
  }

  if (fonte.status === 'blocked') {
    return {
      tipo: 'indisponivel',
      titulo: 'Fonte pública indisponível para automação',
      mensagem: fonte.mensagem || 'O portal oficial bloqueou a consulta automatizada.',
      fonte: fonte.fonte,
      tribunalCodigo: fonte.tribunalCodigo,
      url: fonte.url,
      proximosPassos: [
        'Consultar fonte oficial alternativa.',
        'Usar importação individual por número CNJ quando disponível.',
        'Registrar necessidade de integração formal com o tribunal.',
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

// Rotas de autenticação (públicas)
router.use('/auth', authRouter);

// Todas as demais rotas exigem JWT
router.use(authMiddleware);

// ==================== ROTAS PROTEGIDAS ====================

router.get('/dashboard/movimentacoes', async (req: Request, res: Response) => {
  try {
    const { dias = 7 } = req.query;

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
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar movimentações.' } });
  }
});

router.get('/tribunais/batch-status', async (req: Request, res: Response) => {
  try {
    const { codigos } = req.query;
    const listaCodigos = codigos ? (codigos as string).split(',') : [];

    if (listaCodigos.length === 0) {
      return res.status(400).json({
        erro: { codigo: 'VALIDATION_ERROR', mensagem: 'Informe os códigos dos tribunais.' }
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
  } catch (error) {
    res.status(500).json({ erro: { codigo: 'BATCH_STATUS_ERROR', mensagem: 'Erro ao verificar status.' } });
  }
});

// ==================== ADVOGADOS ====================

router.get('/advogados', async (req: Request, res: Response) => {
  try {
    const advogados = await Advogado.findAll({
      where: { ativo: true },
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
    const advogado = await Advogado.findByPk(req.params.id);
    if (!advogado) {
      return res.status(404).json({ erro: { codigo: 'ADVOGADO_NAO_ENCONTRADO', mensagem: 'Advogado não encontrado.' } });
    }
    res.json({ advogado });
  } catch (error) {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar advogado.' } });
  }
});

router.post('/advogados', async (req: Request, res: Response) => {
  try {
    const { oab, nome, email, skipOnboarding } = req.body;
    
    if (!oab || !nome) {
      return res.status(400).json({ erro: { codigo: 'VALIDATION_ERROR', mensagem: 'OAB e nome são obrigatórios.' } });
    }
    
    const existingAdvogado = await Advogado.findOne({ where: { oab } });
    if (existingAdvogado) {
      return res.status(409).json({ erro: { codigo: 'DUPLICATE_OAB', mensagem: 'Já existe advogado com esta OAB.' } });
    }
    
    const advogado = await Advogado.create({ oab, nome, email });

    if (skipOnboarding !== true) {
      // Onboarding é assíncrono e não deve bloquear a criação do advogado
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
          console.error('Serviço de onboarding indisponível:', err);
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
    const advogado = await Advogado.findByPk(req.params.id);
    if (!advogado) {
      return res.status(404).json({ erro: { codigo: 'ADVOGADO_NAO_ENCONTRADO', mensagem: 'Advogado não encontrado.' } });
    }

    const { default: AdvogadoOnboardingService } = await import('../services/AdvogadoOnboardingService');
    const status = await AdvogadoOnboardingService.getStatusByAdvogadoId(advogado.id);
    res.json({ status });
  } catch (error) {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao criar advogado.' } });
  }
});

router.put('/advogados/:id', async (req: Request, res: Response) => {
  try {
    const advogado = await Advogado.findByPk(req.params.id);
    if (!advogado) {
      return res.status(404).json({ erro: { codigo: 'ADVOGADO_NAO_ENCONTRADO', mensagem: 'Advogado não encontrado.' } });
    }
    
    const { nome, email, ativo } = req.body;
    await advogado.update({ nome, email, ativo });
    
    res.json({ advogado });
  } catch (error) {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao atualizar advogado.' } });
  }
});

router.delete('/advogados/:id', async (req: Request, res: Response) => {
  try {
    const advogado = await Advogado.findByPk(req.params.id);
    if (!advogado) {
      return res.status(404).json({ erro: { codigo: 'ADVOGADO_NAO_ENCONTRADO', mensagem: 'Advogado não encontrado.' } });
    }
    
    await advogado.update({ ativo: false });
    res.json({ mensagem: 'Advogado desativado com sucesso.' });
  } catch (error) {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao desativar advogado.' } });
  }
});

// ==================== PROCESSOS ====================

router.get('/processos', async (req: Request, res: Response) => {
  try {
    const { advogadoId, tribunalId, status, pagina = 1, limite = 50 } = req.query;
    
    const where: any = {};
    if (advogadoId) where.advogadoId = advogadoId;
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
    const processo = await Processo.findByPk(req.params.id, {
      include: [
        { model: Advogado, as: 'advogado' },
        { model: Tribunal, as: 'tribunal' },
        { model: Parte, as: 'partes' },
        { model: Monitoramento, as: 'monitoramentos' },
      ],
    });
    
    if (!processo) {
      return res.status(404).json({ erro: { codigo: 'PROCESSO_NAO_ENCONTRADO', mensagem: 'Processo não encontrado.' } });
    }
    
    res.json({ processo });
  } catch (error) {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar processo.' } });
  }
});

router.get('/processos/:id/enriquecimento/firecrawl', async (req: Request, res: Response) => {
  try {
    const processo = await Processo.findByPk(req.params.id);

    if (!processo) {
      return res.status(404).json({ erro: { codigo: 'PROCESSO_NAO_ENCONTRADO', mensagem: 'Processo não encontrado.' } });
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
          mensagem: 'Firecrawl está desativado. Defina FIRECRAWL_ENABLED=true para usar enriquecimento auxiliar.',
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

    const processo = await Processo.findByPk(req.params.id);

    if (!processo) {
      return res.status(404).json({ erro: { codigo: 'PROCESSO_NAO_ENCONTRADO', mensagem: 'Processo não encontrado.' } });
    }

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
    
    if (!numeroProcesso || !tribunalId || !advogadoId) {
      return res.status(400).json({ 
        erro: { 
          codigo: 'VALIDATION_ERROR', 
          mensagem: 'Número do processo, tribunal e advogado são obrigatórios.' 
        } 
      });
    }
    
    const existingProcesso = await Processo.findOne({ where: { numeroProcesso } });
    if (existingProcesso) {
      return res.status(409).json({ 
        erro: { 
          codigo: 'DUPLICATE_PROCESSO', 
          mensagem: 'Este processo já está cadastrado.' 
        } 
      });
    }
    
    const processo = await Processo.create({ 
      numeroProcesso, 
      tribunalId, 
      advogadoId, 
      classe, 
      assunto,
      instancia: 'PRIMEIRA',
      status: 'MONITORANDO',
    });
    
    // Create initial monitoramento
    await Monitoramento.create({
      advogadoId,
      processoId: processo.id,
      intervaloMinutos: DEFAULT_PROCESS_MONITORING_INTERVAL_MINUTES,
      ativo: true,
    });
    
    res.status(201).json({ processo });
  } catch (error) {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao criar processo.' } });
  }
});

router.delete('/processos/:id', async (req: Request, res: Response) => {
  try {
    const processo = await Processo.findByPk(req.params.id);
    if (!processo) {
      return res.status(404).json({ erro: { codigo: 'PROCESSO_NAO_ENCONTRADO', mensagem: 'Processo não encontrado.' } });
    }
    
    await Monitoramento.destroy({ where: { processoId: req.params.id } });
    await processo.destroy();
    
    res.json({ mensagem: 'Processo removido com sucesso.' });
  } catch (error) {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao remover processo.' } });
  }
});

// ==================== MOVIMENTAÇÕES ====================

router.get('/processos/:id/movimentacoes', async (req: Request, res: Response) => {
  try {
    const { pagina = 1, limite = 50, data_inicio, data_fim } = req.query;
    
    const where: any = { processoId: req.params.id };
    
    if (data_inicio || data_fim) {
      where.data = {};
      if (data_inicio) where.data[Op.gte] = new Date(data_inicio as string);
      if (data_fim) where.data[Op.lte] = new Date(data_fim as string);
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
  } catch (error) {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar movimentações.' } });
  }
});

router.get('/processos/:id/movimentacoes/novas', async (req: Request, res: Response) => {
  try {
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
  } catch (error) {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar movimentações.' } });
  }
});

router.get('/processos/:id/partes', async (req: Request, res: Response) => {
  try {
    const partes = await Parte.findAll({
      where: { processoId: req.params.id },
      order: [['tipo', 'ASC'], ['nome', 'ASC']],
    });
    
    res.json({ partes });
  } catch (error) {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar partes.' } });
  }
});

// ==================== MONITORAMENTOS ====================

router.get('/monitoramentos', async (req: Request, res: Response) => {
  try {
    const { advogadoId, ativo } = req.query;
    
    const where: any = {};
    if (advogadoId) where.advogadoId = advogadoId;
    if (ativo !== undefined) where.ativo = ativo === 'true';
    
    const monitoramentos = await Monitoramento.findAll({
      where,
      include: [
        { model: Processo, as: 'processo' },
        { model: Advogado, as: 'advogado' },
      ],
    });
    
    res.json({ monitoramentos });
  } catch (error) {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar monitoramentos.' } });
  }
});

router.post('/processos/:id/monitorar', async (req: Request, res: Response) => {
  try {
    const intervaloMinutos = normalizeProcessMonitoringInterval(req.body?.intervaloMinutos);
    
    const processo = await Processo.findByPk(req.params.id);
    if (!processo) {
      return res.status(404).json({ erro: { codigo: 'PROCESSO_NAO_ENCONTRADO', mensagem: 'Processo não encontrado.' } });
    }
    
    const existingMonitoramento = await Monitoramento.findOne({
      where: { processoId: req.params.id, ativo: true },
    });
    
    if (existingMonitoramento) {
      await existingMonitoramento.update({ intervaloMinutos });
      return res.json({ monitoramento: existingMonitoramento });
    }

    if (!processo.advogadoId) {
      return res.status(400).json({
        erro: { codigo: 'ADVOGADO_NAO_ASSOCIADO', mensagem: 'Processo não tem advogado associado.' }
      });
    }

    const monitoramento = await Monitoramento.create({
      advogadoId: processo.advogadoId,
      processoId: processo.id,
      intervaloMinutos,
      ativo: true,
    });
    
    res.status(201).json({ monitoramento });
  } catch (error) {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao criar monitoramento.' } });
  }
});

router.delete('/processos/:id/monitorar', async (req: Request, res: Response) => {
  try {
    const monitoramento = await Monitoramento.findOne({
      where: { processoId: req.params.id, ativo: true },
    });
    
    if (!monitoramento) {
      return res.status(404).json({ erro: { codigo: 'MONITORAMENTO_NAO_ENCONTRADO', mensagem: 'Monitoramento não encontrado.' } });
    }
    
    await monitoramento.update({ ativo: false });
    res.json({ mensagem: 'Monitoramento desativado com sucesso.' });
  } catch (error) {
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
      return res.json({ tribunais: JSON.parse(cached), cached: true });
    }

    const tribunais = await Tribunal.findAll({
      where: { ativo: true },
      order: [['nome', 'ASC']],
    });

    // Cache the result
    await cache.set(cacheKey, JSON.stringify(tribunais), CACHE_TTL.TRIBUNAL_STATUS);

    res.set('Cache-Control', 'public, max-age=300');
    res.json({ tribunais });
  } catch (error) {
    logRouteError(req, 'GET /tribunais', error);
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar tribunais.' } });
  }
});

// ==================== TRIBUNAIS - INTEGRAÇÃO ====================

router.post('/tribunais/:codigo/buscar', async (req: Request, res: Response) => {
  try {
    const { codigo } = req.params;
    const { numeroProcesso, advogadoId } = req.body;
    
    if (!numeroProcesso) {
      return res.status(400).json({
        erro: { codigo: 'VALIDATION_ERROR', mensagem: 'Número do processo é obrigatório.' }
      });
    }
    
    const resultado = await TribunalService.buscarESalvarProcesso(
      numeroProcesso,
      codigo.toUpperCase(),
      advogadoId
    );
    
    res.json({
      sucesso: true,
      processo: resultado.processo,
      ehNovo: resultado.ehNovo,
      totalMovimentacoes: resultado.totalMovimentacoes,
      novasMovimentacoes: resultado.novasMovimentacoes,
    });
  } catch (error: any) {
    if (error.message.includes('não suportado') || error.message.includes('não encontrado')) {
      return res.status(400).json({ erro: { codigo: 'TRIBUNAL_ERROR', mensagem: error.message } });
    }
    res.status(500).json({ erro: { codigo: 'SCRAPE_ERROR', mensagem: 'Erro ao buscar processo.' } });
  }
});

router.post('/tribunais/:codigo/buscar-oab', async (req: Request, res: Response) => {
  try {
    const { codigo } = req.params;
    const { oab, nome, advogadoId, forceRefresh, limiteProcessos, onlyMissing } = req.body;

    if (!oab) {
      return res.status(400).json({
        erro: { codigo: 'VALIDATION_ERROR', mensagem: 'OAB é obrigatória.' }
      });
    }

    // Valida tribunal
    const { registry } = await import('../tribunais');
    const adapter = registry.get(codigo.toUpperCase());

    if (!adapter) {
      return res.status(400).json({
        erro: { codigo: 'TRIBUNAL_NOT_SUPPORTED', mensagem: `Tribunal não suportado: ${codigo}` }
      });
    }

    // Usa cache - busca no tribunal apenas se necessario
    const resultado = await TribunalService.buscarPorOABComCache(
      oab,
      codigo.toUpperCase(),
      nome,
      advogadoId,
      forceRefresh === true,
      typeof limiteProcessos === 'number' ? limiteProcessos : undefined,
      onlyMissing === true
    );

    const fontes = resultado.fontes || [];
    const fonteBloqueante = fontes.find(fonte =>
      ['requires-auth', 'captcha', 'blocked'].includes(fonte.status)
    );
    const status: BuscaOABStatus = resultado.processos.length > 0
      ? 'success'
      : ((fonteBloqueante?.status as BuscaOABStatus | undefined) || 'empty');
    const acaoRequerida = buildAcaoRequerida(fonteBloqueante);

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
  } catch (error: any) {
    logger.error(`Erro ao buscar OAB: ${error.message}`);
    res.status(500).json({ erro: { codigo: 'SCRAPE_ERROR', mensagem: 'Erro ao buscar por OAB.' } });
  }
});

router.post('/tribunais/:codigo/buscar-oab/async', async (req: Request, res: Response) => {
  let auditJob: Job | undefined;

  try {
    const { codigo } = req.params;
    const { oab, nome, advogadoId, requestedBy } = req.body;
    const tribunalCodigo = codigo.toUpperCase();
    const buscaNacional = ALL_TRIBUNALS_CODES.has(tribunalCodigo);

    if (!oab || !advogadoId) {
      return res.status(400).json({
        erro: {
          codigo: 'VALIDATION_ERROR',
          mensagem: 'OAB e advogadoId são obrigatórios para busca assíncrona.',
        },
      });
    }

    const { registry } = await import('../tribunais');
    const tribunaisAlvo = buscaNacional
      ? registry.listar().map((tribunal) => tribunal.codigo)
      : [tribunalCodigo];
    const adapter = buscaNacional ? undefined : registry.get(tribunalCodigo);

    if (!buscaNacional && !adapter) {
      return res.status(400).json({
        erro: { codigo: 'TRIBUNAL_NOT_SUPPORTED', mensagem: `Tribunal não suportado: ${codigo}` },
      });
    }

    const advogado = await Advogado.findByPk(advogadoId);
    if (!advogado) {
      return res.status(404).json({
        erro: { codigo: 'ADVOGADO_NAO_ENCONTRADO', mensagem: 'Advogado não encontrado.' },
      });
    }

    const oabNormalizada = String(oab).toUpperCase().replace(/\s/g, '');
    const correlationId = `${advogadoId}:${buscaNacional ? 'TODOS' : tribunalCodigo}:${Date.now()}`;

    auditJob = await Job.create({
      tipo: 'SCRAPE',
      status: 'PENDENTE',
      scheduledAt: new Date(),
      tentativas: 0,
      maxTentativas: 3,
      payload: {
        mode: 'oab_crawl',
        advogadoId,
        oab: oabNormalizada,
        nome,
        tribunalCodigo: buscaNacional ? 'TODOS' : tribunalCodigo,
        tribunais: tribunaisAlvo,
        requestedBy: requestedBy || 'manual-oab-search',
        correlationId,
      },
    });

    const queueJob = await agendarOABCrawl({
      advogadoId,
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
        ? `Busca nacional por OAB agendada em ${tribunaisAlvo.length} tribunais. Os processos serão salvos em background.`
        : 'Busca por OAB agendada. Os processos serão salvos em background.',
    });
  } catch (error: any) {
    if (auditJob) {
      await auditJob.update({
        status: 'FALHO',
        erro: error.message,
        completedAt: new Date(),
      });
    }

    logRouteError(req, 'POST /tribunais/:codigo/buscar-oab/async', error);
    res.status(500).json({ erro: { codigo: 'OAB_ASYNC_ERROR', mensagem: 'Erro ao agendar busca por OAB.' } });
  }
});

router.post('/tribunais/:codigo/processos/:numero/refresh', async (req: Request, res: Response) => {
  try {
    const { codigo, numero } = req.params;
    
    const processo = await Processo.findOne({
      where: { numeroProcesso: numero },
      include: [{ model: Tribunal, as: 'tribunal' }],
    });
    
    if (!processo) {
      return res.status(404).json({
        erro: { codigo: 'PROCESSO_NAO_ENCONTRADO', mensagem: 'Processo não encontrado.' }
      });
    }
    
    const resultado = await TribunalService.atualizarProcesso(processo.id);
    
    res.json({
      sucesso: true,
      processo: resultado.processo,
      novasMovimentacoes: resultado.novasMovimentacoes,
    });
  } catch (error: any) {
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
        erro: { codigo: 'TRIBUNAL_NOT_SUPPORTED', mensagem: `Tribunal não suportado: ${codigo}` }
      });
    }
    
    const healthy = await adapter.healthCheck();
    
    res.json({
      codigo: adapter.codigo,
      usaCaptcha: adapter.usaCaptcha,
      status: healthy ? 'ONLINE' : 'OFFLINE',
    });
  } catch (error) {
    res.status(500).json({ erro: { codigo: 'STATUS_ERROR', mensagem: 'Erro ao verificar status.' } });
  }
});

// ==================== JOBS ====================

router.get('/jobs', async (req: Request, res: Response) => {
  try {
    const { status, tipo, limite = 50 } = req.query;

    const where: any = {};
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

router.get('/jobs/:id', async (req: Request, res: Response) => {
  try {
    const job = await Job.findByPk(req.params.id, {
      include: [{ model: Processo, as: 'processo' }],
    });

    if (!job) {
      return res.status(404).json({ erro: { codigo: 'JOB_NOT_FOUND', mensagem: 'Job não encontrado.' } });
    }

    res.json({ job });
  } catch (error) {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar job.' } });
  }
});

router.post('/jobs/:id/retry', async (req: Request, res: Response) => {
  try {
    const job = await Job.findByPk(req.params.id);

    if (!job) {
      return res.status(404).json({ erro: { codigo: 'JOB_NOT_FOUND', mensagem: 'Job não encontrado.' } });
    }

    await job.update({ status: 'PENDENTE', tentativas: 0, erro: undefined });

    res.json({ job });
  } catch (error) {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao retry job.' } });
  }
});

// ==================== NOTIFICATIONS ====================

router.get('/notifications', async (req: Request, res: Response) => {
  try {
    const { advogadoId, lida, limite = 50 } = req.query;

    const where: any = {};
    if (advogadoId) where.advogadoId = advogadoId;
    if (lida !== undefined) where.lida = lida === 'true';

    const notifications = await Notification.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: Number(limite),
    });

    res.json({ notifications });
  } catch (error) {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar notifications.' } });
  }
});

router.put('/notifications/:id/read', async (req: Request, res: Response) => {
  try {
    const notification = await Notification.findByPk(req.params.id);

    if (!notification) {
      return res.status(404).json({ erro: { codigo: 'NOTIFICATION_NOT_FOUND', mensagem: 'Notificação não encontrada.' } });
    }

    await notification.update({ lida: true });
    res.json({ notification });
  } catch (error) {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao marcar notification.' } });
  }
});

router.put('/notifications/read-all', async (req: Request, res: Response) => {
  try {
    const { advogadoId } = req.query;

    const where: any = { lida: false };
    if (advogadoId) where.advogadoId = advogadoId;

    await Notification.update({ lida: true }, { where });
    res.json({ mensagem: 'Todas marcadas como lidas.' });
  } catch (error) {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao marcar notifications.' } });
  }
});

// ==================== ADVOGADOS / PROCESSOS ====================

router.get('/advogados/:id/processos', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { tribunalId, status, limite = 50 } = req.query;

    const where: any = { advogadoId: id };
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

    const whereAdv: any = { ativo: true };
    if (advogadoId) whereAdv.id = advogadoId;

    const [totalAdvogados, totalProcessos, jobsPendentes, jobsFalhos, monitoramentosAtivos] = await Promise.all([
      Advogado.count({ where: whereAdv }),
      Processo.count({ where: advogadoId ? { advogadoId: String(advogadoId) } : {} }),
      Job.count({ where: { status: 'PENDENTE' } }),
      Job.count({ where: { status: 'FALHO' } }),
      Monitoramento.count({ where: { ativo: true } }),
    ]);

    const totalMovimentacoesHoje = await Movimentacao.count({
      where: {
        createdAt: {
          [Op.gte]: new Date(new Date().setHours(0, 0, 0, 0)),
        },
      },
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
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao buscar estatísticas.' } });
  }
});

export { router };
