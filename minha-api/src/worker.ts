/**
 * Worker standalone — executa scraping e monitoramento em processo separado
 * Uso: npx ts-node src/worker.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { connectDatabase } from './config/database';
import scrapeQueue from './queues/ScraperQueue';
import { notificationService } from './websocket';
import MonitoringService from './services/MonitoringService';
import logger from './config/logger';
import { createServer } from 'http';
import { Server } from 'socket.io';

const PORT = process.env.WORKER_PORT || 4000;

async function main() {
  try {
    // Conecta ao banco
    await connectDatabase();

    // Inicializa WebSocket (necessário para NotificationService)
    const httpServer = createServer();
    const io = new Server(httpServer, {
      cors: { origin: '*', methods: ['GET', 'POST'] },
    });
    (notificationService as any).io = io;
    httpServer.listen(PORT, () => {
      logger.info(`Worker WebSocket listener on port ${PORT}`);
    });

    // Inicia fila Bull (começa automaticamente no import)

    // Inicia serviço de monitoramento
    MonitoringService.start(60 * 1000); // a cada 1 minuto

    logger.info('Worker started successfully');

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received. Shutting down worker...`);
      MonitoringService.stop();
      await notificationService.shutdown();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error('Worker failed to start:', error);
    process.exit(1);
  }
}

main();
