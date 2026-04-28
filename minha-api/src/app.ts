import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { createServer } from 'http';

import logger from './config/logger';
import { connectDatabase, sequelize } from './config/database';
import redis from './config/redis';
import { router } from './routes';
import { notificationService } from './websocket';

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 3000;

// Criar servidor HTTP para integrar com Socket.IO
const httpServer = createServer(app);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    erro: {
      codigo: 'RATE_LIMIT_EXCEDIDO',
      mensagem: 'Muitas requisições. Tente novamente em alguns minutos.',
    },
  },
});
app.use('/api', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    query: req.query,
  });
  next();
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get('/api/v1/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
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

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error:', { error: err.message, stack: err.stack });
  
  res.status(500).json({
    erro: {
      codigo: 'INTERNAL_ERROR',
      mensagem: 'Erro interno do servidor.',
      timestamp: new Date().toISOString(),
    },
  });
});

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`${signal} received. Shutting down gracefully...`);
  
  try {
    // Encerra WebSocket
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

// Start server
const startServer = async () => {
  try {
    await connectDatabase();
    
    // Inicializa WebSocket
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

// Don't auto-start - export for external use
export { app, httpServer, startServer };
