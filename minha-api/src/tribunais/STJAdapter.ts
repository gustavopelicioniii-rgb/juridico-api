/**
 * Adaptador para o Superior Tribunal de Justiça (STJ)
 * 
 * Integração via scraping de HTML
 * O STJ não possui API pública, então usamos parsing de HTML
 */

import { BaseTribunalAdapter, DadosProcesso, DadosParte, DadosMovimentacao, ResultadoBusca } from './ITribunalAdapter';
import logger from '../config/logger';
import axios from 'axios';
import cheerio from 'cheerio';

interface STJProcesso {
  numero: string;
  classe?: string;
  assunto?: string;
  dataDistribution?: string;
  parts?: Array<{ nome: string; tipo: string }>;
  movements?: Array<{ data: string; desc: string }>;
}

export class STJAdapter extends BaseTribunalAdapter {
  codigo = 'STJ';
  usaCaptcha = false;
  
  constructor() {
    super('https://www.stj.jus.br');
  }
  
  /**
   * Busca processo pelo número
   */
  async buscarProcesso(numeroProcesso: string): Promise<DadosProcesso> {
    const numeroFormatado = this.formatarNumeroProcesso(numeroProcesso);
    
    if (!this.validarNumeroProcesso(numeroFormatado)) {
      throw new Error(`Número de processo inválido: ${numeroProcesso}`);
    }
    
    logger.info(`Buscando processo STJ: ${numeroFormatado}`);
    
    try {
      // STJ usa formato de URL específico
      const url = `${this.baseUrl}/web/stj/decisoes/`;
      
      const response = await axios.get(url, {
        params: {
          processo: numeroFormatado,
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
        timeout: 30000,
      });
      
      return this.parseHtml(response.data, numeroFormatado);
    } catch (error: any) {
      logger.error(`Erro ao buscar processo STJ ${numeroFormatado}:`, error.message);
      throw new Error(`Falha ao buscar processo no STJ: ${error.message}`);
    }
  }
  
  /**
   * Parseia HTML do STJ
   */
  private parseHtml(html: string, numero: string): DadosProcesso {
    const $ = cheerio.load(html);
    
    const processo: STJProcesso = {
      numero,
      parts: [],
      movements: [],
    };
    
    // Extrai classe e assunto (seletores dependem da estrutura real do site)
    processo.classe = $('td.classe, .classe-processual').first().text().trim();
    processo.assunto = $('td.assunto, .assunto-processual').first().text().trim();
    
    // Extrai data de distribuição
    const dataText = $('td.data, .data-distribuicao').first().text().trim();
    if (dataText) {
      processo.dataDistribution = this.parseData(dataText);
    }
    
    // Extrai partes
    $('table.partes tr, .partes tr').each((_, el) => {
      const tipo = $(el).find('td:first').text().trim();
      const nome = $(el).find('td:last').text().trim();
      if (nome) {
        processo.parts!.push({ nome, tipo });
      }
    });
    
    // Extrai movimentações
    $('table.movimentacoes tr, .linha-movimentacao').each((_, el) => {
      const data = $(el).find('.data-mov, td:first').text().trim();
      const desc = $(el).find('.descricao-mov, td:last').text().trim();
      if (data && desc) {
        processo.movements!.push({ data, desc });
      }
    });
    
    // Mapeia para formato padronizado
    const partes: DadosParte[] = (processo.parts || []).map(p => ({
      nome: p.nome,
      tipo: this.mapearTipoParte(p.tipo),
      isAdvogado: p.tipo.toLowerCase().includes('advogado'),
    }));
    
    const movimentacoes: DadosMovimentacao[] = (processo.movements || []).map(m => ({
      data: new Date(this.parseData(m.data)),
      descricao: m.desc,
      origem: 'STJ',
      dadosOriginais: m as unknown as Record<string, unknown>,
    }));
    
    return {
      numeroProcesso: numero,
      tribunalCodigo: this.codigo,
      classe: processo.classe,
      assunto: processo.assunto,
      dataDistribuicao: processo.dataDistribution ? new Date(processo.dataDistribution) : undefined,
      partes,
      movimentacoes,
      dadosOriginais: processo as unknown as Record<string, unknown>,
    };
  }
  
  /**
   * Converte data brasileira para ISO
   */
  private parseData(dataStr: string): string {
    // Formato: DD/MM/YYYY ou DD/MM/YYYY HH:mm
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
   * Busca por OAB (não suportado pelo STJ)
   */
  async buscarPorOAB(oab: string, nome?: string): Promise<ResultadoBusca> {
    logger.warn('STJ não suporta busca por OAB');
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

export default STJAdapter;
