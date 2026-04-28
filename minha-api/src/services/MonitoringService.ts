/**
 * Serviço de Monitoramento de Processos
 * Executa polling periódico para verificar novas movimentações
 */

import { Op } from 'sequelize';
import { agendarScraping } from '../queues';
import Monitoramento from '../models/Monitoramento';
import Processo from '../models/Processo';
import Movimentacao from '../models/Movimentacao';
import Tribunal from '../models/Tribunal';
import logger from '../config/logger';

export interface MonitoringResult {
  processoId: string;
  numeroProcesso: string;
  novasMovimentacoes: number;
  sucesso: boolean;
}

class MonitoringService {
  private isRunning: boolean = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private intervalMs: number = 60 * 1000; // 1 minuto default
  
  /**
   * Inicia o serviço de monitoramento
   */
  start(intervalMs?: number): void {
    if (this.isRunning) {
      logger.warn('MonitoringService já está rodando');
      return;
    }
    
    if (intervalMs) {
      this.intervalMs = intervalMs;
    }
    
    this.isRunning = true;
    
    // Executa imediatamente
    this.poll();
    
    // Agenda execução periódica
    this.pollInterval = setInterval(() => {
      this.poll();
    }, this.intervalMs);
    
    logger.info(`MonitoringService iniciado. Intervalo: ${this.intervalMs}ms`);
  }
  
  /**
   * Para o serviço de monitoramento
   */
  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isRunning = false;
    logger.info('MonitoringService parado');
  }
  
  /**
   * Executa uma rodada de polling
   */
  async poll(): Promise<void> {
    if (!this.isRunning) return;
    
    logger.debug('Iniciando rodada de polling...');
    
    try {
      // Busca monitoramentos ativos
      const monitoramentos = await Monitoramento.findAll({
        where: { ativo: true },
        include: [
          { 
            model: Processo, 
            as: 'processo',
            where: { status: 'MONITORANDO' }
          },
        ],
      });
      
      if (monitoramentos.length === 0) {
        logger.debug('Nenhum monitoramento ativo encontrado');
        return;
      }
      
      logger.info(`Polling: ${monitoramentos.length} processos para verificar`);
      
      const results: MonitoringResult[] = [];
      
      for (const monitoramento of monitoramentos) {
        const result = await this.processMonitoramento(monitoramento);
        results.push(result);
      }
      
      const sucessos = results.filter(r => r.sucesso).length;
      logger.info(`Polling concluído: ${sucessos}/${results.length} processos atualizados com sucesso`);
      
    } catch (error) {
      logger.error('Erro na rodada de polling:', error);
    }
  }
  
  /**
   * Processa um monitoramento específico
   */
  private async processMonitoramento(monitoramento: Monitoramento): Promise<MonitoringResult> {
    const processo = await Processo.findByPk(monitoramento.processoId);
    
    if (!processo) {
      return {
        processoId: monitoramento.processoId,
        numeroProcesso: 'DESCONHECIDO',
        novasMovimentacoes: 0,
        sucesso: false,
      };
    }
    
    try {
      // Verifica se já passou o intervalo mínimo
      const agora = new Date();
      const ultimoPoll = monitoramento.ultimoPoll || new Date(0);
      const diffMs = agora.getTime() - ultimoPoll.getTime();
      
      if (diffMs < monitoramento.intervaloMinutos * 60 * 1000) {
        logger.debug(`Processo ${processo.numeroProcesso} ainda não precisa de atualização`);
        return {
          processoId: processo.id,
          numeroProcesso: processo.numeroProcesso,
          novasMovimentacoes: 0,
          sucesso: true,
        };
      }
      
      // Atualiza timestamp de último poll
      await monitoramento.update({ ultimoPoll: agora });
      
      // Agenda scraping na fila (não executa diretamente para não bloquear)
      const tribunal = await Tribunal.findByPk(processo.tribunalId);
      await agendarScraping({
        numeroProcesso: processo.numeroProcesso,
        tribunalCodigo: tribunal?.codigo || 'TJSP',
        advogadoId: processo.advogadoId,
        processoId: processo.id,
        prioridade: 1, // Baixa prioridade para polling
      });
      
      // Busca count de novas movimentações desde o último poll
      const novasMovimentacoes = await Movimentacao.count({
        where: {
          processoId: processo.id,
          nova: true,
          createdAt: { [Op.gt]: ultimoPoll },
        },
      });
      
      return {
        processoId: processo.id,
        numeroProcesso: processo.numeroProcesso,
        novasMovimentacoes,
        sucesso: true,
      };
      
    } catch (error: any) {
      logger.error(`Erro ao processar monitoramento ${monitoramento.id}:`, error);
      return {
        processoId: processo.id,
        numeroProcesso: processo.numeroProcesso,
        novasMovimentacoes: 0,
        sucesso: false,
      };
    }
  }
  
  /**
   * Cria monitoramento para um processo
   */
  async criarMonitoramento(
    processoId: string,
    advogadoId: string,
    intervaloMinutos: number = 60
  ): Promise<Monitoramento> {
    // Verifica se já existe monitoramento ativo
    const existente = await Monitoramento.findOne({
      where: { processoId, ativo: true },
    });
    
    if (existente) {
      // Atualiza intervalo
      await existente.update({ intervaloMinutos });
      return existente;
    }
    
    return Monitoramento.create({
      processoId,
      advogadoId,
      intervaloMinutos,
      ativo: true,
      ultimoPoll: new Date(),
    });
  }
  
  /**
   * Remove monitoramento
   */
  async removerMonitoramento(processoId: string): Promise<boolean> {
    const monitoramento = await Monitoramento.findOne({
      where: { processoId, ativo: true },
    });
    
    if (!monitoramento) return false;
    
    await monitoramento.update({ ativo: false });
    return true;
  }
  
  /**
   * Lista processos sendo monitorados
   */
  async listarMonitoramentos(advogadoId?: string): Promise<Monitoramento[]> {
    const where: any = { ativo: true };
    if (advogadoId) {
      where.advogadoId = advogadoId;
    }
    
    return Monitoramento.findAll({
      where,
      include: [
        { model: Processo, as: 'processo' },
      ],
      order: [['createdAt', 'DESC']],
    });
  }
}

export default new MonitoringService();
