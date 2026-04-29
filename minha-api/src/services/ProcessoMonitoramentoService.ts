/**
 * Sistema de Monitoramento de Novos Processos por OAB
 *
 * Polling periódico: verifica novos processos de OABs cadastradas
 * e notifica clientes via WebSocket quando novos processos surgem.
 */

import { Op } from 'sequelize';
import { registry } from '../tribunais';

const buscarPorOABEnriquecido = async (oab: string, _completo: boolean): Promise<{ processos: any[] }> => ({ processos: [] });
const salvarLoteProcessos = async (_processos: any[]): Promise<{ salvos: number; erros: number }> => ({ salvos: 0, erros: 0 });

import { Processo, OABMonitorada } from '../models';
import notificationService from '../websocket/NotificationService';
import logger from '../config/logger';

const INTERVALO_PADRAO_MS = 5 * 60 * 1000;

interface StatusMonitoramento {
  rodando: boolean;
  ultimaExecucao: Date | null;
  oabsMonitoradas: number;
  processosEncontradosTotal: number;
  erros: number;
}

interface ResultadoVerificacao {
  oab: string;
  processosTotal: number;
  processosNovos: string[];
  processosAtualizados: string[];
  erros: string[];
}

class ProcessoMonitoramentoService {
  private intervalId: NodeJS.Timeout | null = null;
  private status: StatusMonitoramento = {
    rodando: false,
    ultimaExecucao: null,
    oabsMonitoradas: 0,
    processosEncontradosTotal: 0,
    erros: 0,
  };

  iniciar(intervaloMs = INTERVALO_PADRAO_MS): void {
    if (this.intervalId) {
      logger.warn('[Monitoramento] Já está rodando');
      return;
    }

    logger.info(`[Monitoramento] Iniciando com intervalo de ${intervaloMs}ms`);
    this.verificarTodos();

    this.intervalId = setInterval(() => {
      this.verificarTodos();
    }, intervaloMs);

    this.status.rodando = true;
  }

  parar(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.status.rodando = false;
    logger.info('[Monitoramento] Parado');
  }

  getStatus(): StatusMonitoramento {
    return { ...this.status };
  }

  async verificarTodos(): Promise<void> {
    if (!this.status.rodando) return;

    logger.info('[Monitoramento] Iniciando verificação de OABs...');
    const inicio = Date.now();

    try {
      const oabs = await OABMonitorada.findAll({
        where: { ativo: true },
        raw: true,
      });

      this.status.oabsMonitoradas = oabs.length;

      if (oabs.length === 0) {
        logger.info('[Monitoramento] Nenhuma OAB para monitorar');
        return;
      }

      for (const oab of oabs) {
        try {
          const resultado = await this.verificarOAB(oab.oab);

          if (resultado.processosNovos.length > 0) {
            await this.notificarNovosProcessos(oab.oab, resultado);
          }

          await new Promise(r => setTimeout(r, 1500));
        } catch (error: any) {
          logger.error(`[Monitoramento] Erro ao verificar OAB ${oab.oab}: ${error.message}`);
          this.status.erros++;
        }
      }

      this.status.ultimaExecucao = new Date();
      const duracao = Date.now() - inicio;

      logger.info(`[Monitoramento] Verificação concluída em ${duracao}ms. OABs: ${oabs.length}`);
    } catch (error: any) {
      logger.error(`[Monitoramento] Erro geral na verificação: ${error.message}`);
      this.status.erros++;
    }
  }

  async verificarOAB(oab: string): Promise<ResultadoVerificacao> {
    const resultado: ResultadoVerificacao = {
      oab,
      processosTotal: 0,
      processosNovos: [],
      processosAtualizados: [],
      erros: [],
    };

    try {
      const numerosAtuais: string[] = [];

      try {
        const adapter = registry.get('TJSP');
        if (adapter) {
          const busca = await adapter.buscarPorOAB(oab.toUpperCase().replace(/\s/g, ''));
          resultado.processosTotal = busca.processos.length;
          numerosAtuais.push(...busca.processos.map((r: any) => r.numeroProcesso));
        }
      } catch (error: any) {
        resultado.erros.push(`DataJud: ${error.message}`);
      }

      if (numerosAtuais.length === 0) {
        return resultado;
      }

      const jaSalvos = await Processo.findAll({
        where: { numeroProcesso: { [Op.in]: numerosAtuais } },
        attributes: ['numeroProcesso', 'createdAt'],
        raw: true,
      });

      const numerosSalvos = new Set(jaSalvos.map((p: any) => p.numeroProcesso));

      resultado.processosNovos = numerosAtuais.filter(n => !numerosSalvos.has(n));
      resultado.processosAtualizados = numerosAtuais.filter(n => numerosSalvos.has(n));

      if (resultado.processosNovos.length > 0) {
        logger.info(`[Monitoramento] ${oab}: ${resultado.processosNovos.length} novos processos`);

        const resultadoEnriquecido = await buscarPorOABEnriquecido(oab, true);

        const novosEnriquecidos = resultadoEnriquecido.processos.filter(
          (p: any) => resultado.processosNovos.includes(p.numeroProcesso)
        );

        const { salvos, erros } = await salvarLoteProcessos(novosEnriquecidos);

        if (salvos > 0) {
          logger.info(`[Monitoramento] ${oab}: ${salvos} processos novos salvos`);
          this.status.processosEncontradosTotal += salvos;
        }

        if (erros > 0) {
          resultado.erros.push(`${erros} erros ao salvar`);
          this.status.erros += erros;
        }
      }

      await OABMonitorada.update(
        { ultimaVerificacao: new Date() },
        { where: { oab: oab.toUpperCase().replace(/\s/g, '') } }
      );
    } catch (error: any) {
      logger.error(`[Monitoramento] Erro ao verificar OAB ${oab}: ${error.message}`);
      resultado.erros.push(error.message);
      this.status.erros++;
    }

    return resultado;
  }

  private async notificarNovosProcessos(
    oab: string,
    resultado: ResultadoVerificacao
  ): Promise<void> {
    try {
      notificationService.broadcast({
        tipo: 'SCRAPING_COMPLETO',
        processoId: oab,
        numeroProcesso: oab,
        advogadoId: oab,
        dados: {
          mensagem: `${resultado.processosNovos.length} novos processos encontrados para OAB ${oab}`,
        },
        timestamp: new Date(),
      });

      logger.info(
        `[Monitoramento] Notificou ${resultado.processosNovos.length} novos processos para OAB ${oab}`
      );
    } catch (error: any) {
      logger.warn(`[Monitoramento] Erro ao notificar: ${error.message}`);
    }
  }

  async cadastrarOABMonitorada(
    oab: string,
    usuarioId?: number,
    intervaloMinutos = 5
  ): Promise<OABMonitorada> {
    const oabFormatada = oab.toUpperCase().replace(/\s/g, '');

    const [oabMonitorada] = await OABMonitorada.findOrCreate({
      where: { oab: oabFormatada },
      defaults: {
        oab: oabFormatada,
        ativo: true,
        intervaloMinutos,
        usuarioId: usuarioId ?? null,
        ultimaVerificacao: undefined,
      },
    });

    if (!oabMonitorada.ativo) {
      await oabMonitorada.update({ ativo: true });
    }

    logger.info(`[Monitoramento] OAB ${oabFormatada} cadastrada para monitoramento`);
    this.verificarOAB(oabFormatada);

    return oabMonitorada;
  }

  async removerOABMonitorada(oab: string): Promise<void> {
    await OABMonitorada.update(
      { ativo: false },
      { where: { oab: oab.toUpperCase().replace(/\s/g, '') } }
    );
    logger.info(`[Monitoramento] OAB ${oab} removida do monitoramento`);
  }

  async listarOABsMonitoradas(): Promise<OABMonitorada[]> {
    return OABMonitorada.findAll({
      where: { ativo: true },
      order: [['ultimaVerificacao', 'DESC NULLS LAST']] as any,
    });
  }

  async forcarVerificacao(): Promise<void> {
    await this.verificarTodos();
  }
}

export default new ProcessoMonitoramentoService();
