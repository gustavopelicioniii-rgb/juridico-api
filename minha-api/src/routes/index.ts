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
import { authRouter } from './auth';
import { authMiddleware, requireRole } from '../middleware/auth';
import { cache, CACHE_TTL, CACHE_KEYS } from '../config/redis';
import logger from '../config/logger';

const router = Router();

const getRequestId = (req: Request): string | undefined => {
  const withRequestId = req as Request & { requestId?: string };
  return withRequestId.requestId;
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

// ==================== ROTAS PÚBLICAS (sem auth) ====================

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

// Todas as rotas abaixo requerem autenticação
router.use(authMiddleware);

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
    const { oab, nome, email } = req.body;
    
    if (!oab || !nome) {
      return res.status(400).json({ erro: { codigo: 'VALIDATION_ERROR', mensagem: 'OAB e nome são obrigatórios.' } });
    }
    
    const existingAdvogado = await Advogado.findOne({ where: { oab } });
    if (existingAdvogado) {
      return res.status(409).json({ erro: { codigo: 'DUPLICATE_OAB', mensagem: 'Já existe advogado com esta OAB.' } });
    }
    
    const advogado = await Advogado.create({ oab, nome, email });

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

router.put('/advogados/:id', requireRole('ADMIN'), async (req: Request, res: Response) => {
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
      intervaloMinutos: 60,
      ativo: true,
    });
    
    res.status(201).json({ processo });
  } catch (error) {
    res.status(500).json({ erro: { codigo: 'DB_ERROR', mensagem: 'Erro ao criar processo.' } });
  }
});

router.delete('/processos/:id', requireRole('ADMIN'), async (req: Request, res: Response) => {
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
    const { intervaloMinutos = 60 } = req.body;
    
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

router.post('/tribunais/:codigo/buscar', requireRole('ADMIN', 'USER'), async (req: Request, res: Response) => {
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
    const { oab, nome, advogadoId } = req.body;
    
    if (!oab) {
      return res.status(400).json({
        erro: { codigo: 'VALIDATION_ERROR', mensagem: 'OAB é obrigatória.' }
      });
    }
    
    // Busca apenas no tribunal especificado
    const { registry } = await import('../tribunais');
    const adapter = registry.get(codigo.toUpperCase());
    
    if (!adapter) {
      return res.status(400).json({
        erro: { codigo: 'TRIBUNAL_NOT_SUPPORTED', mensagem: `Tribunal não suportado: ${codigo}` }
      });
    }
    
    const resultado = await adapter.buscarPorOAB(oab, nome);
    
    // Salva os processos encontrados
    const processosSalvos = [];
    for (const proc of resultado.processos) {
      try {
        const r = await TribunalService.buscarESalvarProcesso(
          proc.numeroProcesso,
          codigo.toUpperCase(),
          advogadoId
        );
        processosSalvos.push(r.processo);
      } catch (e) {
        // Continua mesmo se falhar um processo
      }
    }
    
    res.json({
      sucesso: true,
      totalEncontrados: resultado.total,
      processos: processosSalvos,
    });
  } catch (error: any) {
    res.status(500).json({ erro: { codigo: 'SCRAPE_ERROR', mensagem: 'Erro ao buscar por OAB.' } });
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
