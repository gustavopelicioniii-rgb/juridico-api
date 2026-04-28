/**
 * Adaptador para Tribunais Regionais do Trabalho (TRT)
 * 
 * Integração via scraping de HTML
 * Cada TRT pode ter uma estrutura diferente, mas seguimos um padrão genérico
 */

import { BaseTribunalAdapter, DadosProcesso, DadosParte, DadosMovimentacao, ResultadoBusca } from './ITribunalAdapter';
import logger from '../config/logger';
import axios from 'axios';
import cheerio from 'cheerio';

export class TRTAdapter extends BaseTribunalAdapter {
  codigo = 'TRT';
  usaCaptcha = false;
  
  private regiao: number;
  
  constructor(regiao: number = 2) { // Default: TRT-2 (SP)
    const baseUrl = `https://www.trt${regiao}.jus.br`;
    super(baseUrl);
    this.regiao = regiao;
  }
  
  /**
   * Busca processo pelo número
   */
  async buscarProcesso(numeroProcesso: string): Promise<DadosProcesso> {
    const numeroFormatado = this.formatarNumeroProcesso(numeroProcesso);
    
    if (!this.validarNumeroProcesso(numeroFormatado)) {
      throw new Error(`Número de processo inválido: ${numeroProcesso}`);
    }
    
    logger.info(`Buscando processo TRT-${this.regiao}: ${numeroFormatado}`);
    
    try {
      const url = `${this.baseUrl}/consulta-processo`;
      
      const response = await axios.get(url, {
        params: { numero: numeroFormatado },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html',
        },
        timeout: 30000,
      });
      
      return this.parseHtml(response.data, numeroFormatado);
    } catch (error: any) {
      logger.error(`Erro ao buscar processo TRT-${this.regiao}:`, error.message);
      throw new Error(`Falha ao buscar processo no TRT-${this.regiao}`);
    }
  }
  
  /**
   * Parseia HTML do TRT
   */
  private parseHtml(html: string, numero: string): DadosProcesso {
    const $ = cheerio.load(html);
    
    const processo: any = {
      numero,
      partes: [],
      movimentacoes: [],
    };
    
    // Extrai classe e assunto
    processo.classe = $('[class*="classe"], .classeProcessual').first().text().trim();
    processo.assunto = $('[class*="assunto"], .assuntoProcessual').first().text().trim();
    
    // Extrai data de distribuição
    const dataText = $('[class*="data"], .dataDistribuicao').first().text().trim();
    if (dataText) {
      processo.dataDistribuicao = this.parseData(dataText);
    }
    
    // Extrai partes
    $('table.partes tr, .dados-parte').each((_, el) => {
      const tipo = $(el).find('.tipo-parte, td:first').text().trim();
      const nome = $(el).find('.nome-parte, td:last').text().trim();
      if (nome) {
        processo.partes.push({ tipo, nome });
      }
    });
    
    // Extrai movimentações
    $('table.movimentacoes tr, .linha-movimentacao').each((_, el) => {
      const data = $(el).find('.data-mov, td:first').text().trim();
      const desc = $(el).find('.desc-mov, td:last').text().trim();
      if (data && desc) {
        processo.movimentacoes.push({ data, descricao: desc });
      }
    });
    
    // Mapeia para formato padronizado
    const partes: DadosParte[] = processo.partes.map((p: any) => ({
      nome: p.nome,
      tipo: this.mapearTipoParte(p.tipo),
      isAdvogado: p.tipo.toLowerCase().includes('advogado'),
    }));
    
    const movimentacoes: DadosMovimentacao[] = processo.movimentacoes.map((m: any) => ({
      data: new Date(this.parseData(m.data)),
      descricao: m.descricao,
      origem: `TRT-${this.regiao}`,
      dadosOriginais: m as unknown as Record<string, unknown>,
    }));
    
    return {
      numeroProcesso: numero,
      tribunalCodigo: `${this.codigo}${this.regiao}`,
      classe: processo.classe,
      assunto: processo.assunto,
      dataDistribuicao: processo.dataDistribuicao ? new Date(processo.dataDistribuicao) : undefined,
      partes,
      movimentacoes,
      dadosOriginais: processo as unknown as Record<string, unknown>,
    };
  }
  
  /**
   * Converte data brasileira para ISO
   */
  private parseData(dataStr: string): string {
    const match = dataStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (match) {
      const [, dia, mes, ano] = match;
      return `${ano}-${mes}-${dia}`;
    }
    return new Date().toISOString();
  }
  
  /**
   * Mapeia tipo de parte
   */
  private mapearTipoParte(tipo: string): DadosParte['tipo'] {
    const t = tipo.toLowerCase();
    if (t.includes('autor') || t.includes('requerente') || t.includes('reclamante')) return 'AUTOR';
    if (t.includes('reu') || t.includes('requerido') || t.includes('reclamado')) return 'REU';
    if (t.includes('advogado')) return 'ADVOGADO';
    return 'OUTRO';
  }
  
  /**
   * Busca por OAB (não suportado)
   */
  async buscarPorOAB(_oab: string, _nome?: string): Promise<ResultadoBusca> {
    logger.warn(`TRT-${this.regiao} não suporta busca por OAB`);
    return { processos: [], total: 0 };
  }
  
  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await axios.head(this.baseUrl, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}

export default TRTAdapter;
