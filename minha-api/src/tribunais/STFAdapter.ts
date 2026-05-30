/**
 * Adaptador para o Supremo Tribunal Federal (STF)
 * 
 * Integração via scraping de HTML
 * O STF possui consulta processual no site oficial
 */

import { BaseTribunalAdapter, DadosProcesso, DadosParte, DadosMovimentacao, ResultadoBusca } from './ITribunalAdapter';
import logger from '../config/logger';
import axios from 'axios';
import { load } from 'cheerio';

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

interface STFProcesso {
  numero: string;
  classe?: string;
  assunto?: string;
  dataDistribuicao?: string;
  partes: Array<{ nome: string; tipo: string }>;
  movimentacoes: Array<{ data: string; descricao: string }>;
}

export class STFAdapter extends BaseTribunalAdapter {
  codigo = 'STF';
  usaCaptcha = true; // STF pode ter CAPTCHA
  
  constructor() {
    super('https://portal.stf.jus.br');
  }
  
  /**
   * Busca processo pelo número
   */
  async buscarProcesso(numeroProcesso: string): Promise<DadosProcesso> {
    const numeroFormatado = this.formatarNumeroProcesso(numeroProcesso);
    
    // STF usa formato específico (0000000-00.0000.0.00.0000)
    if (!this.validarNumeroProcesso(numeroFormatado)) {
      throw new Error(`Número de processo STF inválido: ${numeroProcesso}`);
    }
    
    logger.info(`Buscando processo STF: ${numeroFormatado}`);
    
    try {
      const url = `${this.baseUrl}/processos/`;
      
      const response = await axios.get(url, {
        params: { processo: numeroFormatado },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
        timeout: 30000,
      });
      
      return this.parseHtml(response.data, numeroFormatado);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      logger.error(`Erro ao buscar processo STF ${numeroFormatado}:`, message);
      throw new Error(`Falha ao buscar processo no STF: ${message}`);
    }
  }
  
  /**
   * Parseia HTML do STF
   */
  private parseHtml(html: string, numero: string): DadosProcesso {
    const $ = load(html);
    
    const processo: STFProcesso = {
      numero,
      partes: [],
      movimentacoes: [],
    };
    
    // Extrai classe
    processo.classe = $('[class*="classe"], .classe-processual').first().text().trim();
    
    // Extrai assunto
    processo.assunto = $('[class*="assunto"], .assunto-processual').first().text().trim();
    
    // Extrai data de distribuição
    const dataText = $('[class*="data"], .data-distribuicao').first().text().trim();
    if (dataText) {
      processo.dataDistribuicao = this.parseData(dataText);
    }
    
    // Extrai partes
    $('[class*="parte"], .parte-processual').each((_, el) => {
      const texto = $(el).text().trim();
      if (texto) {
        // Formato típico: "AUTOR: Nome do Autor"
        const partes = texto.split(':');
        if (partes.length >= 2) {
          processo.partes.push({
            tipo: partes[0].trim(),
            nome: partes.slice(1).join(':').trim(),
          });
        }
      }
    });
    
    // Extrai movimentações
    $('[class*="movimentacao"], .movimentacao').each((_, el) => {
      const texto = $(el).text().trim();
      if (texto) {
        // Formato: "DD/MM/YYYY - Descrição"
        const match = texto.match(/^(\d{2}\/\d{2}\/\d{4})\s*-\s*(.+)$/);
        if (match) {
          processo.movimentacoes.push({
            data: match[1],
            descricao: match[2],
          });
        }
      }
    });
    
    // Mapeia para formato padronizado
    const partes: DadosParte[] = processo.partes.map(p => ({
      nome: p.nome,
      tipo: this.mapearTipoParte(p.tipo),
      isAdvogado: p.tipo.toLowerCase().includes('advogado'),
    }));
    
    const movimentacoes: DadosMovimentacao[] = processo.movimentacoes.map(m => ({
      data: new Date(this.parseData(m.data)),
      descricao: m.descricao,
      origem: 'STF',
      dadosOriginais: m as unknown as Record<string, unknown>,
    }));
    
    return {
      numeroProcesso: numero,
      tribunalCodigo: this.codigo,
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
    if (t.includes('autor') || t.includes('requerente') || t.includes('impetrante') || t.includes('embargante')) {
      return 'AUTOR';
    }
    if (t.includes('reu') || t.includes('requerido') || t.includes('paciente') || t.includes('embargado')) {
      return 'REU';
    }
    if (t.includes('advogado')) {
      return 'ADVOGADO';
    }
    return 'OUTRO';
  }
  
  /**
   * Busca por OAB (não suportado pelo STF)
   */
  async buscarPorOAB(_oab: string, _nome?: string): Promise<ResultadoBusca> {
    logger.warn('STF não suporta busca por OAB');
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

export default STFAdapter;
