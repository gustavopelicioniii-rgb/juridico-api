/**
 * Interface base para adaptadores de tribunais
 * Implementa o padrão Adapter para permitir múltiplas integrações
 */

export interface DadosParte {
  nome: string;
  tipo: 'AUTOR' | 'REU' | 'ADVOGADO' | 'LITISDENUNCIANTE' | 'LITISDENUNCIADO' | 'TERCEIRO' | 'OUTRO';
  documento?: string;
  isAdvogado: boolean;
  /** Advogado(s) da parte (campo preenchido pela API DataJud) */
  advogados?: DadosAdvogado[];
}

export interface DadosAdvogado {
  nome: string;
  numeroOAB?: string;
  ufOAB?: string;
  tipo?: 'CONSTITUIDO' | 'ADVDO_ESTAGIARIO' | 'DEFENSOR_PUBLICO' | 'OUTRO';
}

export interface DadosMovimentacao {
  data: Date;
  descricao: string;
  origem: string;
  /** Código numérico do movimento (ex: 12240 = "Julgamento") */
  codigoMovimento?: number;
  dadosOriginais: Record<string, unknown>;
}

export interface DadosProcesso {
  numeroProcesso: string;
  tribunalCodigo: string;
  classe?: string;
  classeCodigo?: number;
  assunto?: string;
  /** Primeiro assunto (assunto principal) */
  assuntoPrincipal?: string;
  instancia?: 'PRIMEIRA' | 'SEGUNDA' | 'SUPERIOR';
  dataDistribuicao?: Date;
  /** Data de ajuizamento (pode diferir da distribuição) */
  dataAjuizamento?: Date;
  /** Valor total da causa em reais */
  valorCausa?: number;
  orgaoJulgador?: string;
  orgaoJulgadorCodigo?: number;
  nivelSigilo?: number;
  sistema?: string;
  formato?: string;
  partes: DadosParte[];
  movimentacoes: DadosMovimentacao[];
  /** URL do processo no portal do tribunal (se disponível) */
  urlPortal?: string;
  dadosOriginais: Record<string, unknown>;
}

export interface ResultadoBusca {
  processos: Array<{
    numeroProcesso: string;
    tribunalCodigo: string;
    classe?: string;
    classeCodigo?: number;
    assunto?: string;
    assuntoPrincipal?: string;
    dataAjuizamento?: string;
    orgaoJulgador?: string;
    orgaoJulgadorCodigo?: number;
    valorCausa?: number;
    instancia?: 'PRIMEIRA' | 'SEGUNDA' | 'SUPERIOR';
    formato?: string;
    sistema?: string;
    partes?: DadosParte[];
    advogados?: DadosAdvogado[];
    movimentacoes?: DadosMovimentacao[];
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
   * @param oab Número da OAB (com ou sem UF)
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
      return true;
    } catch {
      return false;
    }
  }

  protected formatarNumeroProcesso(numero: string): string {
    return numero.replace(/[./-]/g, '');
  }

  protected validarNumeroProcesso(numero: string): boolean {
    const limpo = this.formatarNumeroProcesso(numero);
    return /^\d{7,25}$/.test(limpo);
  }

  /**
   * Formata OAB para o padrão DataJud (número + UF sem espaços)
   * Ex: "361329 SP" -> "000361329"
   * Ex: "361329"   -> "000361329"
   */
  protected formatarOAB(oab: string): string {
    // Remove UF e espaços
    const parts = oab.trim().split(/\s+/);
    const numero = parts[0].replace(/\D/g, '');
    // Retorna o número sem padding de zeros
    return numero;
  }

  /**
   * Extrai UF de uma OAB
   * Ex: "361329 SP" -> "SP"
   * Ex: "361329"   -> undefined
   */
  protected extrairUFOAB(oab: string): string | undefined {
    const parts = oab.trim().split(/\s+/);
    if (parts.length >= 2) {
      return parts[1].toUpperCase();
    }
    return undefined;
  }
}
