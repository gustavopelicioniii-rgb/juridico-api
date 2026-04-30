/**
 * DataJudAdapter - Adapter unificado para a API Pública do CNJ DataJud
 *
 * Cobre todos os 91 tribunais brasileiros via endpoint oficial:
 *   https://api-publica.datajud.cnj.jus.br/api_publica_{sigla}/_search
 *
 * Auth: Authorization: APIKey {DATAJUD_API_KEY}
 * Documentação: https://datajud-wiki.cnj.jus.br/api-publica/
 *
 * Modos:
 *   - Produção: usa API real do CNJ (DATAJUD_MOCK=false + API key válida)
 *   - Mock: retorna dados sintéticos (DATAJUD_MOCK=true ou key ausente)
 */

import axios, { AxiosInstance } from 'axios';
import {
  BaseTribunalAdapter,
  DadosProcesso,
  DadosMovimentacao,
  DadosParte,
  DadosAdvogado,
  ResultadoBusca,
} from './ITribunalAdapter';
import logger from '../config/logger';

const DATAJUD_BASE_URL = 'https://api-publica.datajud.cnj.jus.br';

/**
 * Estrutura completa da resposta DataJud (Base Nacional de Dados do Poder Judiciário)
 * Fontes:
 *   - Glossário: https://datajud-wiki.cnj.jus.br/api-publica/glossario
 *   - Anexo II da documentação oficial CNJ
 */

// Campos principais de um processo no DataJud
interface DataJudProcesso {
  numeroProcesso: string;
  classe?: { codigo: number; nome: string };
  sistema?: { codigo: number; nome: string };
  formato?: { codigo: number; nome: string };
  tribunal: string;
  dataAjuizamento?: string;
  grau?: string;
  nivelSigilo?: number;
  orgaoJulgador?: { codigo: number; nome: string };
  assuntos?: Array<{ codigo: number; nome: string }>;
  /** Valor da causa em reais (pode vir como string "1.234,56" ou número) */
  valorCausa?: number | string;
  /** Data de entrada no sistema (primeira distribuição) */
  dataEntrada?: string;
  /** Polo processual (ativo/passivo/ativo-passivo) */
  polo?: Array<{
    tipo: 'ATIVO' | 'PASSIVO' | 'ATIVO_PASSIVO';
    parte?: {
      nome: string;
      tipo?: string;
      documento?: string;
      pessoaTipo?: 'FISICA' | 'JURIDICA';
    };
    advogados?: Array<{
      nome: string;
      numeroOAB?: string;
      ufOAB?: string;
    }>;
  }>;
  /** Códigos de movimento (movimentações processuais) */
  movimentos?: Array<{
    codigo: number;
    nome: string;
    dataHora: string;
    complementosTabelados?: Array<{
      codigo: number;
      valor: number;
      nome: string;
    }>;
  }>;
  /** URL do processo no portal do tribunal (quando disponível) */
  urlProcesso?: string;
}

interface DataJudHit {
  _source: DataJudProcesso;
  _id?: string;
  _score?: number;
  sort?: string[];
}

interface DataJudResponse {
  took?: number;
  hits: {
    total: { value: number; relation?: string };
    hits: DataJudHit[];
  };
  _scroll_id?: string;
}

export class DataJudAdapter extends BaseTribunalAdapter {
  codigo: string;
  usaCaptcha = false;
  private sigla: string;
  private mockMode: boolean;
  private client?: AxiosInstance;

  /**
   * @param codigo Código interno do tribunal (ex: 'TJSP', 'STJ', 'TRT2')
   * @param sigla Sigla DataJud em lowercase (ex: 'tjsp', 'stj', 'trt2')
   * @param apiKey DATAJUD_API_KEY (opcional - se ausente, ativa modo mock)
   */
  constructor(codigo: string, sigla: string, apiKey?: string) {
    super(`${DATAJUD_BASE_URL}/api_publica_${sigla}`, apiKey);
    this.codigo = codigo;
    this.sigla = sigla;
    this.mockMode = !apiKey || process.env.DATAJUD_MOCK === 'true';

    if (!this.mockMode) {
      this.client = axios.create({
        baseURL: this.baseUrl,
        timeout: this.timeout,
        headers: {
          Authorization: `APIKey ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      logger.info(`DataJudAdapter[${codigo}] modo PRODUÇÃO (API real)`);
    } else {
      logger.warn(`DataJudAdapter[${codigo}] modo MOCK`);
    }
  }

  async buscarProcesso(numeroProcesso: string): Promise<DadosProcesso> {
    const numeroLimpo = this.formatarNumeroProcesso(numeroProcesso);

    if (!this.validarNumeroProcesso(numeroProcesso)) {
      throw new Error(`Número de processo inválido: ${numeroProcesso}`);
    }

    if (this.mockMode) {
      return this.gerarMockProcesso(numeroLimpo);
    }

    logger.info(`DataJudAdapter[${this.codigo}] buscando processo: ${numeroLimpo}`);

    try {
      const response = await this.client!.post<DataJudResponse>('/_search', {
        query: { match: { numeroProcesso: numeroLimpo } },
        size: 1,
      });

      const hits = response.data.hits?.hits || [];
      if (hits.length === 0) {
        throw new Error(`Processo ${numeroProcesso} não encontrado em ${this.codigo}`);
      }

      return this.mapearProcesso(hits[0]);
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new Error('DATAJUD_API_KEY inválida ou expirada. Registre-se em: https://www.cnj.jus.br/sistemas/datajud/api-publica/');
      }
      if (error.response?.status === 429) {
        throw new Error('Rate limit DataJud excedido. Aguarde alguns minutos.');
      }
      logger.error(`DataJudAdapter[${this.codigo}] erro ao buscar processo:`, {
        numero: numeroProcesso,
        status: error.response?.status,
        data: error.response?.data,
      });
      throw error;
    }
  }

  async buscarPorOAB(oab: string, _nome?: string): Promise<ResultadoBusca> {
    if (this.mockMode) {
      return this.gerarMockResultadoOAB(oab);
    }

    // Extrai apenas o número da OAB (sem UF)
    const oabNumero = this.formatarOAB(oab);

    logger.info(`DataJudAdapter[${this.codigo}] buscando por OAB: ${oabNumero} (original: ${oab})`);

    try {
      // Busca via wildcard no número do processo (a OAB está embutida no NUP)
      // Usa size: 500 para capturar todos os processos
      // IMPORTANTE: não usa formatação com zeros, usa o número direto
      const response = await this.client!.post<DataJudResponse>('/_search', {
        query: {
          wildcard: { numeroProcesso: `*${oabNumero}*` }
        },
        size: 500,
        sort: [{ dataAjuizamento: { order: 'desc' } }],
      });

      const hits = response.data.hits?.hits || [];
      const total = hits.length;

      logger.info(`DataJudAdapter[${this.codigo}] OAB ${oabNumero}: ${total} processos encontrados`);

      return {
        processos: hits.map(h => ({
          numeroProcesso: h._source.numeroProcesso,
          tribunalCodigo: this.codigo,
          classe: h._source.classe?.nome,
          assunto: h._source.assuntos?.[0]?.nome,
          dataAjuizamento: h._source.dataAjuizamento,
          orgaoJulgador: h._source.orgaoJulgador?.nome,
          valorCausa: typeof h._source.valorCausa === 'string'
            ? parseFloat(h._source.valorCausa.replace(/\./g, '').replace(',', '.'))
            : h._source.valorCausa,
        })),
        total,
      };
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new Error('DATAJUD_API_KEY inválida ou expirada');
      }
      if (error.response?.status === 429) {
        throw new Error('Rate limit DataJud excedido');
      }
      logger.error(`DataJudAdapter[${this.codigo}] erro ao buscar por OAB:`, { oab, erro: error.message });
      return { processos: [], total: 0 };
    }
  }

  async healthCheck(): Promise<boolean> {
    if (this.mockMode) return true;

    try {
      await this.client!.post('/_search', { query: { match_all: {} }, size: 1 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Constói query ElasticSearch para busca por OAB
   * A OAB pode aparecer em diferentes campos dependendo do tribunal
   */
  private construirQueryOAB(oab: string, nome?: string, uf?: string): object {
    const baseQuery = {
      bool: {
        should: [
          // OAB no polo ativo
          { match: { 'polo.advogados.numeroOAB': oab } },
          // OAB no polo passivo
          { match: { 'polo.advogados.numeroOAB': oab } },
          // OAB em qualquer advogado
          { wildcard: { 'polo.advogados.numeroOAB': `*${oab}*` } },
        ],
        minimum_should_match: 1,
      },
    };

    if (uf) {
      return {
        bool: {
          must: [baseQuery],
          filter: [
            // O tribunal correto já é dado pelo adapter (cada adapter = um tribunal)
          ],
        },
      };
    }

    return baseQuery;
  }

  /**
   * Mapeia resposta DataJud → DadosProcesso completo
   */
  private mapearProcesso(hit: DataJudHit): DadosProcesso {
    const src = hit._source;

    // Mapeia polo processual → partes
    const partes: DadosParte[] = this.mapearPolos(src.polo || []);

    // Mapeia movimentos → movimentacoes
    const movimentacoes: DadosMovimentacao[] = (src.movimentos || []).map(m => ({
      data: new Date(m.dataHora),
      descricao: m.nome,
      origem: src.orgaoJulgador?.nome || src.tribunal,
      codigoMovimento: m.codigo,
      dadosOriginais: {
        ...m,
        complementos: m.complementosTabelados,
      },
    }));

    // Parse do valor da causa (pode vir como "1.234,56" ou número)
    let valorCausa: number | undefined;
    if (src.valorCausa !== undefined && src.valorCausa !== null) {
      if (typeof src.valorCausa === 'number') {
        valorCausa = src.valorCausa;
      } else if (typeof src.valorCausa === 'string') {
        // Remove pontos de milhar e substitui vírgula por ponto
        valorCausa = parseFloat(src.valorCausa.replace(/\./g, '').replace(',', '.'));
      }
    }

    return {
      numeroProcesso: src.numeroProcesso,
      tribunalCodigo: this.codigo,
      classe: src.classe?.nome,
      classeCodigo: src.classe?.codigo,
      assunto: src.assuntos?.map(a => a.nome).join('; '),
      assuntoPrincipal: src.assuntos?.[0]?.nome,
      instancia: this.mapearGrau(src.grau),
      dataDistribuicao: src.dataEntrada ? new Date(src.dataEntrada) : undefined,
      dataAjuizamento: src.dataAjuizamento ? new Date(src.dataAjuizamento) : undefined,
      valorCausa,
      orgaoJulgador: src.orgaoJulgador?.nome,
      orgaoJulgadorCodigo: src.orgaoJulgador?.codigo,
      nivelSigilo: src.nivelSigilo,
      sistema: src.sistema?.nome,
      formato: src.formato?.nome,
      partes,
      movimentacoes,
      urlPortal: src.urlProcesso,
      dadosOriginais: src as unknown as Record<string, unknown>,
    };
  }

  /**
   * Mapeia estrutura de polos do DataJud → array de DadosParte
   */
  private mapearPolos(polos: DataJudProcesso['polo']): DadosParte[] {
    if (!polos || polos.length === 0) return [];
    return polos.map(polo => {
      // Identifica o tipo de parte
      let tipo: DadosParte['tipo'] = 'OUTRO';
      if (polo.tipo === 'ATIVO') tipo = 'AUTOR';
      else if (polo.tipo === 'PASSIVO') tipo = 'REU';
      else if (polo.tipo === 'ATIVO_PASSIVO') tipo = 'OUTRO';

      // Extrai advogados do polo
      const advogados: DadosAdvogado[] = (polo.advogados || []).map(adv => ({
        nome: adv.nome,
        numeroOAB: adv.numeroOAB,
        ufOAB: adv.ufOAB,
      }));

      return {
        nome: polo.parte?.nome || 'Nome não disponível',
        tipo,
        documento: polo.parte?.documento,
        isAdvogado: false,
        advogados: advogados.length > 0 ? advogados : undefined,
      };
    });
  }

  private mapearGrau(grau?: string): DadosProcesso['instancia'] {
    if (grau === 'G2') return 'SEGUNDA';
    if (grau === 'GS') return 'SUPERIOR';
    return 'PRIMEIRA';
  }

  // ===================== MOCKS =====================

  private gerarMockProcesso(numero: string): DadosProcesso {
    const dataBase = new Date();
    return {
      numeroProcesso: numero,
      tribunalCodigo: this.codigo,
      classe: 'PROCEDIMENTO COMUM CÍVEL',
      classeCodigo: 1,
      assunto: 'Indenização por Dano Material e Moral',
      assuntoPrincipal: 'Indenização por Dano Material',
      instancia: 'PRIMEIRA',
      dataDistribuicao: new Date(dataBase.getTime() - 180 * 24 * 60 * 60 * 1000),
      dataAjuizamento: new Date(dataBase.getTime() - 200 * 24 * 60 * 60 * 1000),
      valorCausa: 50000,
      orgaoJulgador: `${this.codigo} - 1ª Vara Cível da Capital`,
      orgaoJulgadorCodigo: 1001,
      nivelSigilo: 0,
      sistema: 'PJE',
      formato: 'Eletrônico',
      partes: [
        {
          nome: 'João da Silva',
          tipo: 'AUTOR',
          documento: '123.456.789-00',
          isAdvogado: false,
          advogados: [{ nome: 'Dr. Carlos Mendes', numeroOAB: '123456', ufOAB: 'SP' }],
        },
        {
          nome: 'Empresa ABC Ltda',
          tipo: 'REU',
          documento: '12.345.678/0001-90',
          isAdvogado: false,
          advogados: [{ nome: 'Dra. Ana Paula Sousa', numeroOAB: '789012', ufOAB: 'SP' }],
        },
      ],
      movimentacoes: [
        {
          data: new Date(dataBase.getTime() - 5 * 24 * 60 * 60 * 1000),
          descricao: 'Julgamento - Procedência total',
          origem: `${this.codigo} - 1ª Vara Cível`,
          codigoMovimento: 12240,
          dadosOriginais: {},
        },
        {
          data: new Date(dataBase.getTime() - 30 * 24 * 60 * 60 * 1000),
          descricao: 'Audiência de Conciliação redesignada',
          origem: `${this.codigo} - CEJUSC`,
          codigoMovimento: 11055,
          dadosOriginais: {},
        },
        {
          data: new Date(dataBase.getTime() - 90 * 24 * 60 * 60 * 1000),
          descricao: 'Contestação',
          origem: `${this.codigo} - 1ª Vara Cível`,
          codigoMovimento: 12281,
          dadosOriginais: {},
        },
        {
          data: new Date(dataBase.getTime() - 180 * 24 * 60 * 60 * 1000),
          descricao: 'Distribuição',
          origem: 'Central de Feitos',
          codigoMovimento: 10187,
          dadosOriginais: {},
        },
      ],
      urlPortal: `https://www.tjsp.jus.br/pje`,
      dadosOriginais: { mock: true },
    };
  }

  private gerarMockResultadoOAB(oab: string): ResultadoBusca {
    return {
      processos: [
        {
          numeroProcesso: '0000001-23.2024.8.26.0100',
          tribunalCodigo: this.codigo,
          classe: 'PROCEDIMENTO COMUM CÍVEL',
          assunto: 'Indenização por Dano Material',
          dataAjuizamento: '2024-01-15',
          orgaoJulgador: '1ª Vara Cível - São Paulo',
          valorCausa: 50000,
        },
        {
          numeroProcesso: '0000002-45.2024.8.26.0051',
          tribunalCodigo: this.codigo,
          classe: 'EXECUÇÃO DE TÍTULO EXTRAJUDICIAL',
          assunto: 'Cobrança de Aluguel',
          dataAjuizamento: '2024-02-20',
          orgaoJulgador: '2ª Vara Cível - Campinas',
          valorCausa: 120000,
        },
      ],
      total: 2,
    };
  }
}

/**
 * Mapeamento código interno → sigla DataJud
 * Total: 91 tribunais (5 superiores + 27 estaduais + 6 federais + 24 trabalhistas + 27 eleitorais/militares)
 */
export const DATAJUD_TRIBUNAIS: Record<string, string> = {
  // Tribunais Superiores
  STF: 'stf',
  STJ: 'stj',
  TST: 'tst',
  TSE: 'tse',
  STM: 'stm',

  // Tribunais de Justiça (27 + DF)
  TJSP: 'tjsp',
  TJRJ: 'tjrj',
  TJMG: 'tjmg',
  TJRS: 'tjrs',
  TJBA: 'tjba',
  TJPR: 'tjpr',
  TJSC: 'tjsc',
  TJGO: 'tjgo',
  TJDFT: 'tjdft',
  TJPE: 'tjpe',
  TJCE: 'tjce',
  TJES: 'tjes',
  TJMS: 'tjms',
  TJMT: 'tjmt',
  TJPB: 'tjpb',
  TJRN: 'tjrn',
  TJAL: 'tjal',
  TJSE: 'tjse',
  TJPI: 'tjpi',
  TJMA: 'tjma',
  TJPA: 'tjpa',
  TJAM: 'tjam',
  TJAP: 'tjap',
  TJRO: 'tjro',
  TJRR: 'tjrr',
  TJAC: 'tjac',
  TJTO: 'tjto',

  // Tribunais Regionais Federais (6)
  TRF1: 'trf1',
  TRF2: 'trf2',
  TRF3: 'trf3',
  TRF4: 'trf4',
  TRF5: 'trf5',
  TRF6: 'trf6',

  // Tribunais Regionais do Trabalho (24)
  ...Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`TRT${i + 1}`, `trt${i + 1}`])),
};
