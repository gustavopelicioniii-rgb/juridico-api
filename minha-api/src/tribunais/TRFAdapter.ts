/**
 * Adaptador para Tribunais Regionais Federais (TRF)
 * 
 * Integração via scraping de HTML
 * Cada TRF pode ter uma estrutura diferente
 */

import { BaseTribunalAdapter, DadosProcesso, DadosParte, DadosMovimentacao, ResultadoBusca } from './ITribunalAdapter';
import logger from '../config/logger';
import axios from 'axios';
import cheerio from 'cheerio';

export class TRFAdapter extends BaseTribunalAdapter {
  codigo = 'TRF';
  usaCaptcha = true; // TRFs geralmente têm CAPTCHA
  
  private regiao: number;
  
  constructor(regiao: number = 3) { // Default: TRF-3 (SP/MS)
    const baseUrl = `https://www.trf${regiao}.jus.br`;
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
    
    logger.info(`Buscando processo TRF-${this.regiao}: ${numeroFormatado}`);
    
    try {
      const url = `${this.baseUrl}/processual`;
      
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
      logger.error(`Erro ao buscar processo TRF-${this.regiao}:`, error.message);
      throw new Error(`Falha ao buscar processo no TRF-${this.regiao}`);
    }
  }
  
  /**
   * Parseia HTML do TRF
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
    const dataText = $('[class*="data"], .dataDist').first().text().trim();
    if (dataText) {
      processo.dataDistribuicao = this.parseData(dataText);
    }
    
    // Extrai partes
    $('table.tabela-partes tr, .parte-processo').each((_, el) => {
      const tipo = $(el).find('td:first, .tipo').text().trim();
      const nome = $(el).find('td:last, .nome').text().trim();
      if (nome) {
        processo.partes.push({ tipo, nome });
      }
    });
    
    // Extrai movimentações
    $('table.movimentacoes tr, .movimentacao').each((_, el) => {
      const data = $(el).find('.data-mov').text().trim();
      const desc = $(el).find('.desc-mov, .descricao').text().trim();
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
      origem: `TRF-${this.regiao}`,
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
    if (t.includes('autor') || t.includes('requerente') || t.includes('impetrante')) return 'AUTOR';
    if (t.includes('reu') || t.includes('requerido') || t.includes('paciente')) return 'REU';
    if (t.includes('advogado')) return 'ADVOGADO';
    return 'OUTRO';
  }
  
  /**
   * Busca por OAB (não suportado)
   */
  async buscarPorOAB(_oab: string, _nome?: string): Promise<ResultadoBusca> {
    logger.warn(`TRF-${this.regiao} não suporta busca por OAB`);
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

export default TRFAdapter;
