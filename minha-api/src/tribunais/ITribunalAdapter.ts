/**
 * Interface base para adaptadores de tribunais
 * Implementa o padrão Adapter para permitir múltiplas integrações
 */

export interface DadosParte {
  nome: string;
  tipo: 'AUTOR' | 'REU' | 'ADVOGADO' | 'OUTRO';
  documento?: string;
  isAdvogado: boolean;
}

export interface DadosMovimentacao {
  data: Date;
  descricao: string;
  origem: string;
  dadosOriginais: Record<string, unknown>;
}

export interface DadosProcesso {
  numeroProcesso: string;
  tribunalCodigo: string;
  classe?: string;
  assunto?: string;
  instancia?: 'PRIMEIRA' | 'SEGUNDA' | 'SUPERIOR';
  dataDistribuicao?: Date;
  partes: DadosParte[];
  movimentacoes: DadosMovimentacao[];
  dadosOriginais: Record<string, unknown>;
}

export interface ResultadoBusca {
  processos: Array<{
    numeroProcesso: string;
    tribunalCodigo: string;
    classe?: string;
    assunto?: string;
  }>;
  total: number;
}

export interface ITribunalAdapter {
  /** Código único do tribunal (ex: TJSP, TJMG) */
  codigo: string;
  
  /** Se o tribunal requer resolução de CAPTCHA */
  usaCaptcha: boolean;
  
  /**
   * Busca um processo específico pelo número
   * @param numeroProcesso Número do processo (com ou sem formatação)
   * @returns Dados completos do processo
   */
  buscarProcesso(numeroProcesso: string): Promise<DadosProcesso>;
  
  /**
   * Busca processos por OAB do advogado
   * @param oab Número da OAB
   * @param nome Nome completo do advogado (opcional para alguns tribunais)
   * @returns Lista de processos encontrados
   */
  buscarPorOAB(oab: string, nome?: string): Promise<ResultadoBusca>;
  
  /**
   * Verifica se o adapter está configurado corretamente
   */
  healthCheck(): Promise<boolean>;
}

export abstract class BaseTribunalAdapter implements ITribunalAdapter {
  abstract codigo: string;
  abstract usaCaptcha: boolean;
  
  protected baseUrl: string;
  protected apiKey?: string;
  protected timeout: number;
  
  constructor(baseUrl: string, apiKey?: string, timeout: number = 30000) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.timeout = timeout;
  }
  
  abstract buscarProcesso(numeroProcesso: string): Promise<DadosProcesso>;
  abstract buscarPorOAB(oab: string, nome?: string): Promise<ResultadoBusca>;
  
  async healthCheck(): Promise<boolean> {
    try {
      // Implementação base - subclasses podem sobrescrever
      return true;
    } catch {
      return false;
    }
  }
  
  protected formatarNumeroProcesso(numero: string): string {
    // Remove formatação (pontos, barras, hífens)
    return numero.replace(/[.\/\-]/g, '');
  }
  
  protected validarNumeroProcesso(numero: string): boolean {
    // Validacao basica de formato de CNJ
    // 20 dígitos para tribunal + 4 dígitos para ano + outros
    const limpo = this.formatarNumeroProcesso(numero);
    return /^\d{7,25}$/.test(limpo);
  }
}
