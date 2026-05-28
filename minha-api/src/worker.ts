/**
 * Worker standalone â€” executa scraping e monitoramento em processo separado
 * Uso: npx ts-node src/worker.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { connectDatabase } from './config/database';
import { startScrapeQueueProcessor } from './queues/ScraperQueue';
import { notificationService } from './websocket';
import MonitoringService from './services/MonitoringService';
import ProcessoMonitoramentoService from './services/ProcessoMonitoramentoService';
import logger from './config/logger';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { DEFAULT_MONITORING_POLL_INTERVAL_MS } from './config/monitoring';

const PORT = process.env.WORKER_PORT || 4000;

async function main() {
  try {
    // Conecta ao banco
    await connectDatabase();

    // Inicializa WebSocket (necessÃ¡rio para NotificationService)
    const httpServer = createServer();
    const io = new Server(httpServer, {
      cors: { origin: '*', methods: ['GET', 'POST'] },
    });
    (notificationService as unknown as { io: Server }).io = io;
    httpServer.listen(PORT, () => {
      logger.info(`Worker WebSocket listener on port ${PORT}`);
    });

    // Inicia fila Bull apenas no processo worker.
    startScrapeQueueProcessor();

    // Inicia serviÃ§o de monitoramento
    const monitoringEnabled = process.env.ENABLE_MONITORING !== 'false';
    const oabMonitoringEnabled = process.env.ENABLE_OAB_MONITORING !== 'false';

    if (monitoringEnabled) {
      MonitoringService.start(DEFAULT_MONITORING_POLL_INTERVAL_MS);
    }
    if (oabMonitoringEnabled) {
      ProcessoMonitoramentoService.iniciar();
    }

    logger.info(`Worker started successfully (monitoring=${monitoringEnabled}, oabMonitoring=${oabMonitoringEnabled})`);

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received. Shutting down worker...`);
      MonitoringService.stop();
      ProcessoMonitoramentoService.parar();
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

