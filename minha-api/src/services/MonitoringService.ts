/**
 * Serviço de Monitoramento de Processos
 * Executa polling periódico para verificar novas movimentações
 */

import { Op, WhereOptions } from 'sequelize';
import { agendarScraping } from '../queues';
import Monitoramento from '../models/Monitoramento';
import Processo from '../models/Processo';
import Movimentacao from '../models/Movimentacao';
import Tribunal from '../models/Tribunal';
import logger from '../config/logger';
import { cache } from '../config/redis';
import {
  DEFAULT_MONITORING_POLL_INTERVAL_MS,
  DEFAULT_PROCESS_MONITORING_INTERVAL_MINUTES,
  normalizeProcessMonitoringInterval,
} from '../config/monitoring';

export interface MonitoringResult {
  processoId: string;
  numeroProcesso: string;
  novasMovimentacoes: number;
  sucesso: boolean;
}

class MonitoringService {
  private isRunning: boolean = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private intervalMs: number = DEFAULT_MONITORING_POLL_INTERVAL_MS;
  private readonly instanceId: string = process.env.MONITORING_INSTANCE_ID || `${process.pid}`;
  private readonly lockKey = 'monitoring:poll:lock';
  private readonly lockEnabled = process.env.MONITORING_DISTRIBUTED_LOCK !== 'false';
  
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
    
    void this.ensureMonitoramentosAtivos();
    void this.poll();
    
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
    let lockAcquired = false;
    
    try {
      if (this.lockEnabled) {
        const lockTtl = Math.max(30, Math.ceil(this.intervalMs / 1000));
        lockAcquired = (await cache.setnx(this.lockKey, this.instanceId, lockTtl)) === 1;
        if (!lockAcquired) {
          logger.debug('Polling ignorado: lock distribuído já está em posse de outra instância');
          return;
        }
      }

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
      
      // Agenda scraping na fila (não executa diretamente para não bloquear)
      const tribunal = await Tribunal.findByPk(processo.tribunalId);
      await agendarScraping({
        numeroProcesso: processo.numeroProcesso,
        tribunalCodigo: tribunal?.codigo || 'TJSP',
        advogadoId: processo.advogadoId,
        processoId: processo.id,
        monitoramentoId: monitoramento.id,
        prioridade: 1, // Baixa prioridade para polling
      });

      // Só avança a janela após o job entrar na fila; falhas de enqueue não podem perder o próximo poll.
      await monitoramento.update({ ultimoPoll: agora });

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
      
    } catch (error) {
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
    intervaloMinutos: number = DEFAULT_PROCESS_MONITORING_INTERVAL_MINUTES,
    pollImmediately = false
  ): Promise<Monitoramento> {
    const intervalo = normalizeProcessMonitoringInterval(intervaloMinutos);

    // Verifica se já existe monitoramento ativo
    const existente = await Monitoramento.findOne({
      where: { processoId, ativo: true },
    });
    
    if (existente) {
      // Atualiza intervalo
      await existente.update({ intervaloMinutos: intervalo });
      return existente;
    }
    
    return Monitoramento.create({
      processoId,
      advogadoId,
      intervaloMinutos: intervalo,
      ativo: true,
      ultimoPoll: pollImmediately ? undefined : new Date(),
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
    const where: WhereOptions = { ativo: true };
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

  /**
   * Garante que processos ativos associados a advogado tenham monitoramento diário.
   */
  private async ensureMonitoramentosAtivos(): Promise<void> {
    try {
      const processos = await Processo.findAll({
        where: { status: 'MONITORANDO' },
        attributes: ['id', 'advogadoId'],
      });

      let criados = 0;
      for (const processo of processos) {
        if (!processo.advogadoId) continue;
        const existente = await Monitoramento.findOne({
          where: { processoId: processo.id, ativo: true },
        });
        if (existente) continue;

        await Monitoramento.create({
          processoId: processo.id,
          advogadoId: processo.advogadoId,
          intervaloMinutos: DEFAULT_PROCESS_MONITORING_INTERVAL_MINUTES,
          ativo: true,
        });
        criados++;
      }

      if (criados > 0) {
        logger.info(`MonitoringService criou ${criados} monitoramentos diários ausentes`);
      }
    } catch (error) {
      logger.error('Erro ao garantir monitoramentos ativos:', error);
    }
  }
}

export default new MonitoringService();
