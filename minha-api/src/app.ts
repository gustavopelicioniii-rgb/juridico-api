import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { z } from 'zod';
import compression from 'compression';

import logger from './config/logger';
import { connectDatabase, sequelize } from './config/database';
import { redis } from './config/redis';
import { router } from './routes';
import { notificationService } from './websocket';
import { requestIdMiddleware, metricsMiddleware, register } from './middleware/metrics';
import { authMiddleware, validateAuthConfig } from './middleware/auth';
import Tribunal from './models/Tribunal';
import Advogado from './models/Advogado';
import bcrypt from 'bcryptjs';
import MonitoringService from './services/MonitoringService';
import ProcessoMonitoramentoService from './services/ProcessoMonitoramentoService';
import ngrokService from './services/NgrokService';
import oabCacheService from './services/OABCacheService';
import { listarTribunaisDataJud } from './config/datajudTribunais';
import { DEFAULT_MONITORING_POLL_INTERVAL_MS } from './config/monitoring';

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 3000;

// Necessário atrás de ngrok/proxies para rate-limit usar o IP correto.
app.set('trust proxy', 1);

// Criar servidor HTTP para integrar com Socket.IO
const httpServer = createServer(app);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", "ws:", "wss:", "http://localhost:*", "https://localhost:*"],
      imgSrc: ["'self'", "data:", "https:"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
}));

// Compression
app.use(compression());

// CORS restrito — apenas origens conhecidas em produção
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:5174,http://localhost:3000').split(',');
app.use(cors({
  origin: (origin, callback) => {
    // Permite requisições sem Origin (curl, Postman) em dev
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Rate limiting geral (mais restritivo para /auth)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10,
  message: {
    erro: { codigo: 'RATE_LIMIT_EXCEDIDO', mensagem: 'Muitas tentativas. Tente novamente em 15 minutos.' },
  },
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT_MAX || 1000),
  message: {
    erro: { codigo: 'RATE_LIMIT_EXCEDIDO', mensagem: 'Muitas requisições. Tente novamente em alguns minutos.' },
  },
});

app.use('/api/v1/auth', authLimiter);
app.use('/api', apiLimiter);

// Body parsing reduzido
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Request ID + metrics middleware
app.use(requestIdMiddleware);
app.use(metricsMiddleware);

// Prometheus metrics
app.get('/metrics', async (_req: Request, res: Response) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err: any) {
    res.status(500).end(err.message);
  }
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get('/api/v1/health', async (_req: Request, res: Response) => {
  try {
    await sequelize.authenticate();
    res.json({
      status: 'ok',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      checks: {
        database: 'ok',
        redis: redis.isAvailable() ? 'ok' : 'fallback',
        websocket: notificationService.getConnectedClientsCount() >= 0 ? 'ok' : 'degraded',
        ngrok: ngrokService.isActive() ? 'ok' : 'inativo',
        oabCache: oabCacheService.getStats().tamanho >= 0 ? 'ok' : 'erro',
      },
      ngrokUrl: ngrokService.getUrl(),
      oabCacheStats: oabCacheService.getStats(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      checks: { database: 'error' },
    });
  }
});

// Crawler health check (stub - crawlers removed)
app.get('/api/v1/health/crawlers', async (_req: Request, res: Response) => {
  res.json({ status: 'unavailable', timestamp: new Date().toISOString() });
});

app.get('/api/v1/metrics/crawlers', async (_req: Request, res: Response) => {
  res.json({ metricas: {} });
});

// ==================== NGROK TUNNEL (protegido) ====================

app.get('/api/v1/ngrok/status', authMiddleware, async (_req: Request, res: Response) => {
  res.json({
    ativo: ngrokService.isActive(),
    url: ngrokService.getUrl(),
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/v1/ngrok/start', authMiddleware, async (_req: Request, res: Response) => {
  try {
    const port = parseInt(_req.query.port as string) || 3000;
    const url = await ngrokService.start(port);
    if (url) {
      res.json({ sucesso: true, url });
    } else {
      res.status(503).json({ erro: { codigo: 'NGROK_ERROR', mensagem: 'Falha ao iniciar tunel ngrok. Verifique NGROK_AUTHTOKEN.' } });
    }
  } catch (error: any) {
    res.status(503).json({ erro: { codigo: 'NGROK_ERROR', mensagem: error.message } });
  }
});

app.post('/api/v1/ngrok/stop', authMiddleware, async (_req: Request, res: Response) => {
  await ngrokService.stop();
  res.json({ sucesso: true, mensagem: 'Tunel ngrok encerrado.' });
});

// ==================== OAB CACHE (protegido) ====================

app.get('/api/v1/oab-cache/stats', authMiddleware, async (_req: Request, res: Response) => {
  res.json(oabCacheService.getStats());
});

app.post('/api/v1/oab-cache/clear', authMiddleware, async (_req: Request, res: Response) => {
  oabCacheService.clear();
  res.json({ sucesso: true, mensagem: 'Cache OAB limpo.' });
});

app.get('/api/v1/oab-cache/entries', authMiddleware, async (_req: Request, res: Response) => {
  res.json({ entradas: oabCacheService.getAll() });
});

// API routes
app.use('/api/v1', router);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    erro: {
      codigo: 'ROUTE_NOT_FOUND',
      mensagem: 'Endpoint não encontrado.',
    },
  });
});

// Error handler com diferenciação de tipos
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const requestId = (_req as any).requestId;

  if (err instanceof z.ZodError) {
    logger.warn('Validation error:', { requestId, errors: err.issues });
    res.status(400).json({
      erro: {
        codigo: 'VALIDATION_ERROR',
        mensagem: 'Dados inválidos.',
        detalhes: err.issues.map((e: z.ZodIssue) => ({ campo: e.path.join('.'), mensagem: e.message })),
        requestId,
      },
    });
    return;
  }

  logger.error('Unhandled error:', { requestId, error: err.message, stack: err.stack });

  res.status(500).json({
    erro: {
      codigo: 'INTERNAL_ERROR',
      mensagem: 'Erro interno do servidor.',
      requestId,
      timestamp: new Date().toISOString(),
    },
  });
});

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`${signal} received. Shutting down gracefully...`);

  try {
    MonitoringService.stop();
    ProcessoMonitoramentoService.parar();

    await ngrokService.stop();

    await notificationService.shutdown();

    await sequelize.close();
    logger.info('Database connection closed.');

    redis.quit();
    logger.info('Redis connection closed.');

    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Auto-seed: popula tribunais e usuário admin no primeiro startup
const autoSeed = async () => {
  for (const data of listarTribunaisDataJud()) {
    const [tribunal, created] = await Tribunal.findOrCreate({ where: { codigo: data.codigo }, defaults: data });
    if (!created) {
      await tribunal.update(data);
    }
  }
  logger.info('Seed: tribunais verificados');

  const adminOab = process.env.ADMIN_OAB;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminOab || !adminPassword) {
    logger.info('Seed: admin ignorado (defina ADMIN_OAB e ADMIN_PASSWORD para criar usuário inicial)');
    return;
  }

  const senhaHash = await bcrypt.hash(adminPassword, 12);
  await Advogado.findOrCreate({
    where: { oab: adminOab },
    defaults: {
      oab: adminOab,
      nome: process.env.ADMIN_NOME || 'Administrador',
      email: process.env.ADMIN_EMAIL,
      ativo: true,
      passwordHash: senhaHash,
    },
  });
  logger.info(`Seed: usuário admin verificado (${adminOab})`);
};

// Start server
const startServer = async () => {
  try {
    validateAuthConfig();
    await connectDatabase();
    await autoSeed();

    notificationService.initialize(httpServer);

    // Inicia MonitoringService se habilitado (padrão: true em produção)
    const monitoringEnabled = process.env.ENABLE_MONITORING !== 'false';
    if (monitoringEnabled) {
      const intervalMs = parseInt(process.env.MONITORING_INTERVAL_MS || String(DEFAULT_MONITORING_POLL_INTERVAL_MS), 10);
      MonitoringService.start(intervalMs);
      logger.info(`MonitoringService enabled (interval: ${intervalMs}ms)`);
    } else {
      logger.info('MonitoringService disabled (ENABLE_MONITORING=false)');
    }

    // Inicia monitoramento de OABs cadastradas
    if (process.env.ENABLE_OAB_MONITORING !== 'false') {
      ProcessoMonitoramentoService.iniciar();
      logger.info('ProcessoMonitoramentoService iniciado');
    }

    // Inicia tunel ngrok se configurado
    const ngrokEnabled = process.env.NGROK_ENABLED === 'true';
    if (ngrokEnabled) {
      const portNgrok = parseInt(process.env.NGROK_PORT || String(PORT), 10);
      // Pequeno delay para garantir que o servidor já está ouvindo
      setTimeout(async () => {
        const url = await ngrokService.start(portNgrok);
        if (url) {
          logger.info(`Ngrok tunnel started: ${url}`);
        }
      }, 2000);
    }

    // Cleanup periódico do cache OAB (a cada 5 minutos)
    setInterval(() => {
      const removidos = oabCacheService.cleanup();
      if (removidos > 0) {
        logger.info(`OABCacheService: ${removidos} entradas expiradas removidas`);
      }
    }, 5 * 60 * 1000);

    httpServer.listen(PORT, () => {
      logger.info(`🚀 Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`WebSocket notifications enabled`);
      if (ngrokEnabled) {
        logger.info(`Ngrok tunnel enabled (will start shortly)`);
      }
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

export { app, httpServer, startServer };
