/**
 * Adaptador para o Tribunal de Justiça de São Paulo (TJ-SP)
 * 
 * Integração via API REST oficial
 * Documentação: https://api.tjsp.jus.br
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { BaseTribunalAdapter, DadosProcesso, DadosParte, DadosMovimentacao, ResultadoBusca } from './ITribunalAdapter';
import logger from '../config/logger';

interface TJSPParte {
  nome: string;
  tipo: string;
  documento?: string;
  qualidade?: string;
}

interface TJSPMovimentacao {
  data: string;
  descricao: string;
  orgao?: string;
}

interface TJSPProcesso {
  numeroProcesso: string;
  classe?: string;
  assunto?: string;
  dataDistribuicao?: string;
  partes?: TJSPParte[];
  movs?: TJSPMovimentacao[];
  dadosOriginais?: Record<string, unknown>;
}

interface TJSPBuscaResponse {
  processos?: TJSPProcesso[];
  total?: number;
}

export class TJSPAdapter extends BaseTribunalAdapter {
  codigo = 'TJSP';
  usaCaptcha = false;
  
  private client: AxiosInstance;
  private rateLimitRemaining: number = 100;
  private rateLimitReset: Date | null = null;
  
  constructor(apiKey?: string) {
    const baseUrl = process.env.TJSP_API_URL || 'https://api.tjsp.jus.br';
    super(baseUrl, apiKey);
    
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(apiKey && { 'Authorization': `Bearer ${apiKey}` }),
      },
    });
    
    // Interceptor para logging
    this.client.interceptors.response.use(
      (response) => {
        this.atualizarRateLimit(response.headers as Record<string, string>);
        logger.debug(`TJSP API: ${response.config.method?.toUpperCase()} ${response.config.url} - ${response.status}`);
        return response;
      },
      (error: AxiosError) => {
        logger.error(`TJSP API Error: ${error.message}`, {
          url: error.config?.url,
          status: error.response?.status,
        });
        throw error;
      }
    );
  }
  
  private atualizarRateLimit(headers: Record<string, string>): void {
    // TJ-SP pode retornar rate limit em headers específicos
    const remaining = headers['x-rate-limit-remaining'];
    const reset = headers['x-rate-limit-reset'];
    
    if (remaining) {
      this.rateLimitRemaining = parseInt(remaining, 10);
    }
    if (reset) {
      this.rateLimitReset = new Date(parseInt(reset, 10) * 1000);
    }
  }
  
  private async verificarRateLimit(): Promise<void> {
    if (this.rateLimitRemaining <= 5 && this.rateLimitReset && new Date() < this.rateLimitReset) {
      const waitTime = this.rateLimitReset.getTime() - Date.now();
      logger.warn(`TJSP Rate Limit baixo. Aguardando ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  /**
   * Busca processo específico pelo número
   * Endpoint: GET /v1/processos/{numero}
   */
  async buscarProcesso(numeroProcesso: string): Promise<DadosProcesso> {
    const numeroFormatado = this.formatarNumeroProcesso(numeroProcesso);
    
    if (!this.validarNumeroProcesso(numeroFormatado)) {
      throw new Error(`Número de processo inválido: ${numeroProcesso}`);
    }
    
    await this.verificarRateLimit();
    
    try {
      // Tenta buscar na API oficial do TJ-SP
      // NOTA: O TJ-SP pode ter diferentes endpoints ou exigir autenticação
      // Esta implementação é um template que deve ser ajustado conforme documentação oficial
      const response = await this.client.get<TJSPProcesso>(
        `/v1/processos/${numeroFormatado}`
      );
      
      return this.mapearProcesso(response.data);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new Error(`Processo não encontrado no TJ-SP: ${numeroProcesso}`);
      }
      
      // Fallback: tenta buscar via endpoint alternativo de consulta pública
      try {
        const processo = await this.buscarProcessoPublico(numeroFormatado);
        return processo;
      } catch (fallbackError) {
        logger.error(`TJSP: Falha ao buscar processo ${numeroProcesso}`, { error: fallbackError });
        throw new Error(`Falha ao buscar processo ${numeroProcesso}: ${fallbackError}`);
      }
    }
  }
  
  /**
   * Busca processo via endpoint público (fallback)
   * Usado quando a API oficial não está disponível
   */
  private async buscarProcessoPublico(numero: string): Promise<DadosProcesso> {
    // Endpoint alternativo - pode variar conforme estrutura do TJ-SP
    const response = await this.client.get<TJSPProcesso>(
      `/consulta/processo/${numero}`,
      {
        // Algumas APIs públicas não requerem autenticação
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      }
    );
    
    return this.mapearProcesso(response.data);
  }
  
  /**
   * Busca processos por OAB
   * Endpoint: GET /v1/processos?oab={oab}
   */
  async buscarPorOAB(oab: string, nome?: string): Promise<ResultadoBusca> {
    // Valida formato da OAB (2 letras + 6 dígitos + 2 letras)
    const oabFormatada = oab.replace(/[.-]/g, '').toUpperCase();
    
    if (!/^[A-Z]{2}\d{6}[A-Z]{2}$/.test(oabFormatada) && !/^\d{6,8}$/.test(oabFormatada)) {
      throw new Error(`OAB inválida: ${oab}`);
    }
    
    await this.verificarRateLimit();
    
    try {
      const params: Record<string, string> = { oab: oabFormatada };
      if (nome) {
        params.nome = nome;
      }
      
      const response = await this.client.get<TJSPBuscaResponse>(
        '/v1/processos',
        { params }
      );
      
      const processos = (response.data.processos || []).map(p => ({
        numeroProcesso: p.numeroProcesso,
        tribunalCodigo: this.codigo,
        classe: p.classe,
        assunto: p.assunto,
      }));
      
      return {
        processos,
        total: response.data.total || processos.length,
      };
    } catch (error) {
      logger.error(`TJSP: Falha ao buscar por OAB ${oab}`, { error });
      throw new Error(`Falha ao buscar processos por OAB: ${error}`);
    }
  }
  
  /**
   * Verifica se o adapter está configurado corretamente
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Testa conexão com API do TJ-SP
      // Pode ser um endpoint de status ou ping
      await this.client.get('/health', { timeout: 5000 });
      return true;
    } catch {
      // Se não tiver endpoint de health, verifica rate limit
      return this.rateLimitRemaining > 0;
    }
  }
  
  /**
   * Mapeia resposta da API para formato padronizado
   */
  private mapearProcesso(dados: TJSPProcesso): DadosProcesso {
    const partes: DadosParte[] = (dados.partes || []).map(p => ({
      nome: p.nome,
      tipo: this.mapearTipoParte(p.tipo || p.qualidade || 'OUTRO'),
      documento: p.documento,
      isAdvogado: p.tipo?.toLowerCase().includes('advogado') || false,
    }));
    
    const movimentacoes: DadosMovimentacao[] = (dados.movs || []).map(m => ({
      data: new Date(m.data),
      descricao: m.descricao,
      origem: m.orgao || this.codigo,
      dadosOriginais: m as unknown as Record<string, unknown>,
    }));
    
    return {
      numeroProcesso: dados.numeroProcesso,
      tribunalCodigo: this.codigo,
      classe: dados.classe,
      assunto: dados.assunto,
      dataDistribuicao: dados.dataDistribuicao ? new Date(dados.dataDistribuicao) : undefined,
      partes,
      movimentacoes,
      dadosOriginais: dados.dadosOriginais || dados as unknown as Record<string, unknown>,
    };
  }
  
  /**
   * Mapeia tipo de parte para formato padronizado
   */
  private mapearTipoParte(tipo: string): DadosParte['tipo'] {
    const tipoLower = tipo.toLowerCase();
    
    if (tipoLower.includes('autor') || tipoLower.includes('exequente') || tipoLower.includes('requerente')) {
      return 'AUTOR';
    }
    if (tipoLower.includes('reu') || tipoLower.includes('executado') || tipoLower.includes('requerido')) {
      return 'REU';
    }
    if (tipoLower.includes('advogado') || tipoLower.includes('patron')) {
      return 'ADVOGADO';
    }
    return 'OUTRO';
  }
}

export default TJSPAdapter;
