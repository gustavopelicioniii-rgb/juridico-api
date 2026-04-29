/**
 * CrawlerObserver - Sistema de Observabilidade para Crawlers
 *
 * Coleta métricas, logs estruturados e health checks para monitorar
 * o comportamento dos crawlers em produção.
 *
 * Métricas coletadas:
 * - Tempo de resposta por tribunal
 * - Taxa de sucesso/falha
 * - Tipos de erro mais comuns
 * - Uso de fallback (DataJud)
 */

import logger from '../config/logger';

export interface CrawlerMetrics {
  tribunalCodigo: string;
  tipo: 'ESAJ' | 'PJE' | 'OTHER';
  requisicoesTotal: number;
  sucessos: number;
  falhas: number;
  captchaDetectado: number;
  captchaResolvido: number;
  fallbackDataJud: number;
  tempoMedioMs: number;
  tempoMinMs: number;
  tempoMaxMs: number;
  ultimaRequisicao: Date | null;
  ultimaSucesso: Date | null;
  ultimaFalha: Date | null;
  errosRecentes: Array<{
    timestamp: Date;
    mensagem: string;
    tipo: string;
  }>;
}

export interface CrawlerHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  tribunais: Record<string, {
    status: 'up' | 'down' | 'degraded';
    tempoMedioMs: number;
    taxaSucesso: number;
    ultimaFalha: Date | null;
  }>;
  fallbackDisponivel: boolean;
  captchaDisponivel: boolean;
}

interface MetricEntry {
  timestamp: number;
  duracaoMs: number;
  sucesso: boolean;
  tipoErro?: string;
  usandoFallback: boolean;
  captchaDetectado: boolean;
  captchaResolvido: boolean;
}

const MAX_ERROS_RECENTES = 10;
const METRICS_WINDOW_MS = 15 * 60 * 1000; // 15 minutos

class CrawlerObserverService {
  private metrics: Map<string, MetricEntry[]> = new Map();
  private singleton: CrawlerObserverService | null = null;

  constructor() {
    // Limpa métricas antigas periodicamente
    setInterval(() => this.limparMetricasAntigas(), 60 * 1000);
  }

  static getInstance(): CrawlerObserverService {
    if (!CrawlerObserverService.instance) {
      CrawlerObserverService.instance = new CrawlerObserverService();
    }
    return CrawlerObserverService.instance;
  }

  /**
   * Registra uma requisição de crawler
   */
  registrarRequisicao(
    tribunalCodigo: string,
    duracaoMs: number,
    sucesso: boolean,
    opcoes?: {
      tipoErro?: string;
      usandoFallback?: boolean;
      captchaDetectado?: boolean;
      captchaResolvido?: boolean;
    }
  ): void {
    const entry: MetricEntry = {
      timestamp: Date.now(),
      duracaoMs,
      sucesso,
      tipoErro: opcoes?.tipoErro,
      usandoFallback: opcoes?.usandoFallback || false,
      captchaDetectado: opcoes?.captchaDetectado || false,
      captchaResolvido: opcoes?.captchaResolvido || false,
    };

    if (!this.metrics.has(tribunalCodigo)) {
      this.metrics.set(tribunalCodigo, []);
    }

    this.metrics.get(tribunalCodigo)!.push(entry);

    // Log estruturado
    logger.info(`[Crawler:${tribunalCodigo}] ${sucesso ? 'SUCESSO' : 'FALHA'}`, {
      duracaoMs,
      sucesso,
      tipoErro: opcoes?.tipoErro,
      usandoFallback: opcoes?.usandoFallback,
      captcha: {
        detectado: opcoes?.captchaDetectado,
        resolvido: opcoes?.captchaResolvido,
      },
    });
  }

  /**
   * Retorna métricas consolidadas para um tribunal
   */
  getMetricas(tribunalCodigo: string): CrawlerMetrics | null {
    const entries = this.metrics.get(tribunalCodigo);
    if (!entries || entries.length === 0) return null;

    const agora = Date.now();
    const recentes = entries.filter(e => agora - e.timestamp < METRICS_WINDOW_MS);

    if (recentes.length === 0) return null;

    const sucessos = recentes.filter(e => e.sucesso);
    const falhas = recentes.filter(e => !e.sucesso);
    const tempos = recentes.map(e => e.duracaoMs);

    const errosRecentes = falhas
      .slice(-MAX_ERROS_RECENTES)
      .map(e => ({
        timestamp: new Date(e.timestamp),
        mensagem: e.tipoErro || 'Erro desconhecido',
        tipo: this.classificarErro(e.tipoErro),
      }));

    const ultimoSucessoEntry = [...sucessos].pop();
    const ultimaFalhaEntry = [...falhas].pop();

    return {
      tribunalCodigo,
      tipo: this.detectarTipoTribunal(tribunalCodigo),
      requisicoesTotal: recentes.length,
      sucessos: sucessos.length,
      falhas: falhas.length,
      captchaDetectado: recentes.filter(e => e.captchaDetectado).length,
      captchaResolvido: recentes.filter(e => e.captchaResolvido).length,
      fallbackDataJud: recentes.filter(e => e.usandoFallback).length,
      tempoMedioMs: Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length),
      tempoMinMs: Math.min(...tempos),
      tempoMaxMs: Math.max(...tempos),
      ultimaRequisicao: recentes.length > 0 ? new Date(recentes[recentes.length - 1].timestamp) : null,
      ultimaSucesso: ultimoSucessoEntry ? new Date(ultimoSucessoEntry.timestamp) : null,
      ultimaFalha: ultimaFalhaEntry ? new Date(ultimaFalhaEntry.timestamp) : null,
      errosRecentes,
    };
  }

  /**
   * Retorna métricas de todos os tribunais
   */
  getTodasMetricas(): Record<string, CrawlerMetrics> {
    const resultado: Record<string, CrawlerMetrics> = {};

    for (const tribunal of this.metrics.keys()) {
      const metricas = this.getMetricas(tribunal);
      if (metricas) {
        resultado[tribunal] = metricas;
      }
    }

    return resultado;
  }

  /**
   * Retorna health check consolidado
   */
  getHealth(): CrawlerHealth {
    const todasMetricas = this.getTodasMetricas();
    const tribunais: CrawlerHealth['tribunais'] = {};

    let totalRequisicoes = 0;
    let totalFalhas = 0;

    for (const [codigo, metricas] of Object.entries(todasMetricas)) {
      totalRequisicoes += metricas.requisicoesTotal;
      totalFalhas += metricas.falhas;

      const taxaSucesso = metricas.requisicoesTotal > 0
        ? (metricas.sucessos / metricas.requisicoesTotal) * 100
        : 0;

      let status: 'up' | 'down' | 'degraded' = 'up';
      if (metricas.ultimaFalha) {
        const tempoDesdeFalha = Date.now() - metricas.ultimaFalha.getTime();
        if (tempoDesdeFalha < 5 * 60 * 1000) { // 5 minutos
          status = 'down';
        } else if (taxaSucesso < 80) {
          status = 'degraded';
        }
      } else if (taxaSucesso < 80) {
        status = 'degraded';
      }

      tribunais[codigo] = {
        status,
        tempoMedioMs: metricas.tempoMedioMs,
        taxaSucesso: Math.round(taxaSucesso),
        ultimaFalha: metricas.ultimaFalha,
      };
    }

    const taxaFalhaGeral = totalRequisicoes > 0
      ? (totalFalhas / totalRequisicoes) * 100
      : 0;

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (taxaFalhaGeral > 20 || Object.values(tribunais).some(t => t.status === 'down')) {
      status = 'unhealthy';
    } else if (taxaFalhaGeral > 5 || Object.values(tribunais).some(t => t.status === 'degraded')) {
      status = 'degraded';
    }

    return {
      status,
      tribunais,
      fallbackDisponivel: true, // DataJud sempre disponível como fallback
      captchaDisponivel: !!process.env.TWOCAPTCHA_API_KEY,
    };
  }

  /**
   * Gera traceId para uma requisição
   */
  gerarTraceId(): string {
    return `crawl-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Limpa métricas antigas (mais de 15 minutos)
   */
  private limparMetricasAntigas(): void {
    const agora = Date.now();

    for (const [tribunal, entries] of this.metrics.entries()) {
      const filtradas = entries.filter(e => agora - e.timestamp < METRICS_WINDOW_MS);

      if (filtradas.length === 0) {
        this.metrics.delete(tribunal);
      } else {
        this.metrics.set(tribunal, filtradas);
      }
    }
  }

  /**
   * Classifica o tipo de erro
   */
  private classificarErro(tipoErro?: string): string {
    if (!tipoErro) return 'UNKNOWN';

    const erroLower = tipoErro.toLowerCase();

    if (erroLower.includes('timeout') || erroLower.includes('etimedout')) {
      return 'TIMEOUT';
    }
    if (erroLower.includes('captcha')) {
      return 'CAPTCHA';
    }
    if (erroLower.includes('network') || erroLower.includes('fetch') || erroLower.includes('econnrefused')) {
      return 'NETWORK';
    }
    if (erroLower.includes('access') || erroLower.includes('forbidden') || erroLower.includes('denied')) {
      return 'ACCESS_DENIED';
    }
    if (erroLower.includes('parse') || erroLower.includes('json') || erroLower.includes('html')) {
      return 'PARSE_ERROR';
    }
    if (erroLower.includes('rate') || erroLower.includes('429')) {
      return 'RATE_LIMIT';
    }

    return 'UNKNOWN';
  }

  /**
   * Detecta o tipo de tribunal pela sigla
   */
  private detectarTipoTribunal(codigo: string): 'ESAJ' | 'PJE' | 'OTHER' {
    if (codigo.startsWith('TRT') || codigo.startsWith('TRF')) {
      return 'PJE'; // TRT/TRF usam PJe
    }
    if (codigo.startsWith('TJ')) {
      return 'ESAJ'; // TJs usam ESAJ
    }
    return 'OTHER';
  }
}

export const CrawlerObserver = CrawlerObserverService.getInstance();
export default CrawlerObserver;
