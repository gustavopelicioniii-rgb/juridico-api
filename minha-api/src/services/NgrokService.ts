/**
 * NgrokService - Gerencia tunel ngrok para expor API local
 *
 * Usa @ngrok/ngrok (oficial, não requer binário) para criar um tunel
 * HTTPS para o servidor local. A URL pública é notificada via WebSocket
 * para que o frontend possa usar em webhooks ou outras integrações.
 */

import ngrok, { Listener } from '@ngrok/ngrok';
import logger from '../config/logger';
import { notificationService } from '../websocket';

class NgrokService {
  private listener: Listener | null = null;
  private url: string | null = null;
  private enabled: boolean = false;
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number = 3;

  /**
   * Inicializa o tunel ngrok
   */
  async start(port: number = 3000): Promise<string | null> {
    if (this.enabled && this.listener) {
      logger.info('NgrokService já está ativo');
      return this.url;
    }

    const authtoken = process.env.NGROK_AUTHTOKEN;

    if (!authtoken) {
      logger.warn('NgrokService: NGROK_AUTHTOKEN não configurado. Tunel não será iniciado.');
      return null;
    }

    try {
      logger.info(`NgrokService: Iniciando tunel para porta ${port}...`);

      const listener = await ngrok.connect({
        addr: port,
        authtoken: authtoken,
        onStatusChange: (status: string | undefined) => {
          if (status) {
            logger.info(`NgrokService: Status alterado: ${status}`);
          }
        },
      });

      this.listener = listener;
      this.enabled = true;
      this.reconnectAttempts = 0;

      const rawUrl = listener.url();
      if (!rawUrl) {
        throw new Error('Ngrok retornou URL nula');
      }
      this.url = rawUrl;

      logger.info(`NgrokService: Tunel ativo! URL pública: ${rawUrl}`);

      this.notifyWebSocket(rawUrl);

      return rawUrl;
    } catch (error: any) {
      logger.error(`NgrokService: Falha ao iniciar tunel: ${error.message}`);

      if (error.message?.includes('auth token')) {
        logger.error('NgrokService: Auth token inválido. Verifique NGROK_AUTHTOKEN no .env');
      } else if (error.message?.includes('session failed') || error.message?.includes('connection refused')) {
        logger.error('NgrokService: Verifique se o servidor está rodando na porta ' + port);
      }

      this.enabled = false;
      return null;
    }
  }

  /**
   * Notifica clientes WebSocket sobre a URL do ngrok
   */
  private notifyWebSocket(url: string): void {
    try {
      notificationService.broadcast({
        tipo: 'PROCESSO_ATUALIZADO',
        processoId: 'ngrok',
        numeroProcesso: 'system',
        advogadoId: 'system',
        dados: {
          mensagem: `Tunnel ngrok ativo: ${url}`,
        },
        timestamp: new Date(),
      });
    } catch (error) {
      logger.warn(`NgrokService: Falha ao notificar WebSocket: ${error}`);
    }
  }

  /**
   * Trata desconexão do tunel
   */
  private handleDisconnect(): void {
    this.listener = null;
    this.url = null;
    this.enabled = false;

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectAttempts * 5000;
      logger.info(`NgrokService: Tentando reconectar em ${delay}ms (tentativa ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      setTimeout(() => { this.start(3000); }, delay);
    } else {
      logger.warn('NgrokService: Máximo de tentativas de reconexão atingido.');
    }
  }

  /**
   * Para o tunel
   */
  async stop(): Promise<void> {
    try {
      if (this.listener && typeof this.listener?.close === 'function') {
        await this.listener.close();
      }
    } catch (error: any) {
      logger.warn(`NgrokService: Erro ao parar tunel: ${error.message}`);
    } finally {
      this.listener = null;
      this.url = null;
      this.enabled = false;
      logger.info('NgrokService: Tunel encerrado');
    }
  }

  /**
   * Retorna URL atual do tunel
   */
  getUrl(): string | null {
    return this.url;
  }

  /**
   * Retorna se o tunel está ativo
   */
  isActive(): boolean {
    return this.enabled && this.url !== null;
  }

  /**
   * Atualiza URL (para casos onde a URL muda após reconnect)
   */
  updateUrl(url: string): void {
    this.url = url;
    this.notifyWebSocket(url);
  }
}

export default new NgrokService();
