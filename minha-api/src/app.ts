import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { z } from 'zod';
import compression from 'compression';
import etag from 'etag';

import logger from './config/logger';
import { connectDatabase, sequelize } from './config/database';
import { redis } from './config/redis';
import { router } from './routes';
import { notificationService } from './websocket';
import { requestIdMiddleware, metricsMiddleware, register } from './middleware/metrics';
import Tribunal from './models/Tribunal';
import Advogado from './models/Advogado';
import bcrypt from 'bcryptjs';

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 3000;

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
  max: 100,
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
        redis: 'ok', // redis status check via ping would require async call
        websocket: notificationService.getConnectedClientsCount() >= 0 ? 'ok' : 'degraded',
      },
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
  const tribunais = [
    { codigo: 'TJSP', nome: 'Tribunal de Justiça de São Paulo', baseUrl: 'https://api.tjsp.jus.br', tipo: 'TJ', usaCaptcha: false, scraperConfig: { endpoint: '/v2/processos' } },
    { codigo: 'TJMG', nome: 'Tribunal de Justiça de Minas Gerais', baseUrl: 'https://www.tjmg.jus.br', tipo: 'TJ', usaCaptcha: true, scraperConfig: { portal: 'cpov' } },
    { codigo: 'STJ', nome: 'Superior Tribunal de Justiça', baseUrl: 'https://www.stj.jus.br', tipo: 'STJ', usaCaptcha: false, scraperConfig: { caminho: '/consultas/processo' } },
    { codigo: 'STF', nome: 'Supremo Tribunal Federal', baseUrl: 'https://portal.stf.jus.br', tipo: 'STF', usaCaptcha: false, scraperConfig: { caminho: '/processos' } },
    { codigo: 'TST', nome: 'Tribunal Superior do Trabalho', baseUrl: 'https://www.tst.jus.br', tipo: 'TRT', usaCaptcha: false, scraperConfig: { caminho: '/consultas' } },
  ];
  for (const data of tribunais) {
    await Tribunal.findOrCreate({ where: { codigo: data.codigo }, defaults: data });
  }
  logger.info('Seed: tribunais verificados');

  const senhaHash = await bcrypt.hash('juridico123', 12);
  await Advogado.findOrCreate({
    where: { oab: 'SP123456' },
    defaults: { oab: 'SP123456', nome: 'João Silva', email: 'joao.silva@exemplo.com', ativo: true, passwordHash: senhaHash },
  });
  logger.info('Seed: usuário admin verificado');
};

// Start server
const startServer = async () => {
  try {
    await connectDatabase();
    await autoSeed();

    notificationService.initialize(httpServer);

    httpServer.listen(PORT, () => {
      logger.info(`🚀 Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`WebSocket notifications enabled`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

export { app, httpServer, startServer };
