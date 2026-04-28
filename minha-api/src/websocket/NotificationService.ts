/**
 * Serviço de Notificações via WebSocket
 * Notifica clientes sobre novas movimentações em tempo real
 */

import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import logger from '../config/logger';

export interface Notificacao {
  tipo: 'NOVA_MOVIMENTACAO' | 'PROCESSO_ATUALIZADO' | 'SCRAPING_COMPLETO' | 'ERRO_SCRAPING';
  processoId: string;
  numeroProcesso: string;
  advogadoId: string;
  dados: {
    novaMovimentacoes?: number;
    mensagem?: string;
    erro?: string;
  };
  timestamp: Date;
}

class NotificationService {
  private io: Server | null = null;
  private connectedClients: Map<string, { socketId: string; advogadoId?: string }> = new Map();
  
  /**
   * Inicializa o servidor WebSocket
   */
  initialize(httpServer: HttpServer): void {
    if (this.io) {
      logger.warn('NotificationService já inicializado');
      return;
    }
    
    this.io = new Server(httpServer, {
      cors: {
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['GET', 'POST'],
      },
      pingTimeout: 60000,
      pingInterval: 25000,
    });
    
    this.io.on('connection', (socket: Socket) => {
      this.handleConnection(socket);
    });
    
    logger.info('NotificationService WebSocket inicializado');
  }
  
  /**
   * Manipula nova conexão
   */
  private handleConnection(socket: Socket): void {
    const clientId = socket.id;
    logger.info(`Cliente conectado: ${clientId}`);
    
    // Extrai advogadoId da query string se presente
    const advogadoId = socket.handshake.query.advogadoId as string | undefined;
    
    this.connectedClients.set(clientId, { socketId: clientId, advogadoId });
    
    // Associa socket ao advogado se autenticado
    if (advogadoId) {
      socket.join(`advogado:${advogadoId}`);
      logger.info(`Socket ${clientId} associado ao advogado ${advogadoId}`);
    }
    
    socket.on('subscribe', (processoId: string) => {
      socket.join(`processo:${processoId}`);
      logger.debug(`Socket ${clientId} inscrito no processo ${processoId}`);
    });
    
    socket.on('unsubscribe', (processoId: string) => {
      socket.leave(`processo:${processoId}`);
      logger.debug(`Socket ${clientId} desinscrito do processo ${processoId}`);
    });
    
    socket.on('disconnect', (reason) => {
      this.connectedClients.delete(clientId);
      logger.info(`Cliente desconectado: ${clientId}, motivo: ${reason}`);
    });
    
    socket.on('error', (error) => {
      logger.error(`Erro no socket ${clientId}:`, error);
    });
  }
  
  /**
   * Envia notificação para um advogado específico
   */
  notificarAdvogado(advogadoId: string, notificacao: Notificacao): void {
    if (!this.io) {
      logger.warn('NotificationService não inicializado');
      return;
    }

    const room = `advogado:${advogadoId}`;

    // Emite tanto o evento unificado quanto o evento específico que o frontend espera
    this.io.to(room).emit('notificacao', notificacao);

    if (notificacao.tipo === 'NOVA_MOVIMENTACAO') {
      this.io.to(room).emit('nova-movimentacao', {
        processoId: notificacao.processoId,
        movimentacao: notificacao,
      });
    } else if (notificacao.tipo === 'SCRAPING_COMPLETO') {
      this.io.to(room).emit('scraping-completo', { processo: notificacao });
    } else if (notificacao.tipo === 'ERRO_SCRAPING') {
      this.io.to(room).emit('erro-scraping', { erro: notificacao.dados.erro });
    }

    logger.debug(`Notificação enviada para advogado ${advogadoId}: ${notificacao.tipo}`);
  }
  
  /**
   * Envia notificação para todos os inscritos em um processo
   */
  notificarProcesso(processoId: string, notificacao: Notificacao): void {
    if (!this.io) {
      logger.warn('NotificationService não inicializado');
      return;
    }
    
    this.io.to(`processo:${processoId}`).emit('notificacao', notificacao);
    logger.debug(`Notificação enviada para processo ${processoId}`);
  }
  
  /**
   * Envia notificação broadcast para todos os clientes conectados
   */
  broadcast(notificacao: Notificacao): void {
    if (!this.io) {
      logger.warn('NotificationService não inicializado');
      return;
    }
    
    this.io.emit('notificacao', notificacao);
    logger.debug('Notificação broadcast enviada');
  }
  
  /**
   * Notifica nova movimentação
   */
  novaMovimentacao(
    processoId: string,
    numeroProcesso: string,
    advogadoId: string,
    quantidade: number
  ): void {
    const notificacao: Notificacao = {
      tipo: 'NOVA_MOVIMENTACAO',
      processoId,
      numeroProcesso,
      advogadoId,
      dados: { novaMovimentacoes: quantidade },
      timestamp: new Date(),
    };
    
    this.notificarAdvogado(advogadoId, notificacao);
    this.notificarProcesso(processoId, notificacao);
  }
  
  /**
   * Notifica scraping completo
   */
  scrapingCompleto(
    processoId: string,
    numeroProcesso: string,
    advogadoId: string
  ): void {
    const notificacao: Notificacao = {
      tipo: 'SCRAPING_COMPLETO',
      processoId,
      numeroProcesso,
      advogadoId,
      dados: {},
      timestamp: new Date(),
    };
    
    this.notificarAdvogado(advogadoId, notificacao);
    this.notificarProcesso(processoId, notificacao);
  }
  
  /**
   * Notifica erro no scraping
   */
  erroScraping(
    processoId: string,
    numeroProcesso: string,
    advogadoId: string,
    erro: string
  ): void {
    const notificacao: Notificacao = {
      tipo: 'ERRO_SCRAPING',
      processoId,
      numeroProcesso,
      advogadoId,
      dados: { erro },
      timestamp: new Date(),
    };
    
    this.notificarAdvogado(advogadoId, notificacao);
    this.notificarProcesso(processoId, notificacao);
  }
  
  /**
   * Retorna número de clientes conectados
   */
  getConnectedClientsCount(): number {
    return this.connectedClients.size;
  }
  
  /**
   * Finaliza o servidor WebSocket
   */
  async shutdown(): Promise<void> {
    if (this.io) {
      await this.io.close();
      this.io = null;
      this.connectedClients.clear();
      logger.info('NotificationService encerrado');
    }
  }
}

export default new NotificationService();
