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
import * as cheerio from 'cheerio';
import {
  BaseTribunalAdapter,
  DadosProcesso,
  DadosMovimentacao,
  DadosParte,
  DadosAdvogado,
  ResultadoBusca,
} from './ITribunalAdapter';
import logger from '../config/logger';
import { buscarPorFontesOficiais, OABSourceLog } from './providers/OABSearchProvider';

const DATAJUD_BASE_URL = 'https://api-publica.datajud.cnj.jus.br';
const ESAJ_TJSP_BASE_URL = 'https://esaj.tjsp.jus.br';

const UF_REGEX = /^(AC|AL|AM|AP|BA|CE|DF|ES|GO|MA|MG|MS|MT|PA|PB|PE|PI|PR|RJ|RN|RO|RR|RS|SC|SE|SP|TO)/i;

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

interface EsajProcessoResumo {
  numeroProcesso: string;
  urlDetalhe?: string;
}

export class DataJudAdapter extends BaseTribunalAdapter {
  codigo: string;
  usaCaptcha = false;
  private sigla: string;
  private mockMode: boolean;
  private client?: AxiosInstance;
  private esajDetailUrlByNumero = new Map<string, string>();

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

      const processo = this.mapearProcesso(hits[0]);
      if (this.codigo === 'TJSP') {
        return this.mesclarComDetalhesEsaj(processo, numeroProcesso);
      }
      return processo;
    } catch (error: any) {
      if (this.codigo === 'TJSP' && error.response?.status !== 401 && error.response?.status !== 429) {
        const detalhesEsaj = await this.buscarProcessoEsajTJSP(numeroProcesso);
        if (detalhesEsaj) return detalhesEsaj;
      }
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

  async buscarPorOAB(oab: string, nome?: string): Promise<ResultadoBusca> {
    if (this.mockMode) {
      return this.gerarMockResultadoOAB(oab);
    }

    // Extrai apenas o número da OAB (sem UF)
    const oabNumero = this.formatarOAB(oab);
    const ufOab = UF_REGEX.exec(oab)?.[1]?.toUpperCase();

    logger.info(`DataJudAdapter[${this.codigo}] buscando por OAB: ${oabNumero} (original: ${oab}, nome: ${nome || 'não informado'})`);

    if (this.codigo === 'TJSP') {
      const resultadoEsaj = await this.buscarPorOABEsajTJSP(oabNumero, nome);
      if (resultadoEsaj.total > 0) {
        logger.info(`DataJudAdapter[${this.codigo}] OAB ${oabNumero}: ${resultadoEsaj.total} processos encontrados via ESAJ`);
        return {
          ...resultadoEsaj,
          fontes: [{
            fonte: 'esaj',
            status: 'success',
            tribunalCodigo: this.codigo,
            url: ESAJ_TJSP_BASE_URL,
            mensagem: 'Processos encontrados via consulta pública ESAJ.',
            total: resultadoEsaj.total,
          }],
        };
      }
      logger.warn(`DataJudAdapter[${this.codigo}] ESAJ não retornou processos para OAB ${oabNumero}; tentando DataJud`);
    }

    const sourceLogs: OABSourceLog[] = [];
    if (this.codigo !== 'TJSP') {
      const officialSources = await buscarPorFontesOficiais({
        tribunalCodigo: this.codigo,
        oabNumero,
        nome,
      });
      sourceLogs.push(...officialSources.logs);
      if (officialSources.processos.length > 0) {
        return {
          processos: officialSources.processos,
          total: officialSources.processos.length,
          fontes: sourceLogs,
        };
      }
    }

    try {
      const must: object[] = [
        {
          bool: {
            should: [
              { term: { 'polo.advogados.numeroOAB': oabNumero } },
              { match: { 'polo.advogados.numeroOAB': oabNumero } },
              { wildcard: { 'polo.advogados.numeroOAB': `*${oabNumero}*` } },
            ],
            minimum_should_match: 1,
          },
        },
      ];

      if (ufOab) {
        must.push({ match: { 'polo.advogados.ufOAB': ufOab } });
      }

      if (nome && nome.trim().length > 0) {
        must.push({
          bool: {
            should: [
              { match_phrase: { 'polo.advogados.nome': nome } },
              { match: { 'polo.advogados.nome': { query: nome, operator: 'and' } } },
            ],
            minimum_should_match: 1,
          },
        });
        logger.info(`DataJudAdapter[${this.codigo}] Filtrando por nome do advogado: ${nome}`);
      }

      const query: object = { bool: { must } };

      const response = await this.client!.post<DataJudResponse>('/_search', {
        query,
        size: 200,
        sort: [{ dataAjuizamento: { order: 'desc' } }],
      });

      const hits = (response.data.hits?.hits || []).filter(hit =>
        this.processoTemAdvogado(hit._source, oabNumero, nome, ufOab)
      );
      const total = hits.length;

      logger.info(`DataJudAdapter[${this.codigo}] OAB ${oabNumero}: ${total} processos encontrados`);
      sourceLogs.push({
        fonte: 'datajud',
        status: total > 0 ? 'success' : 'empty',
        tribunalCodigo: this.codigo,
        url: this.baseUrl,
        mensagem: total > 0
          ? 'Processos encontrados no DataJud com OAB indexada.'
          : 'DataJud respondeu, mas não expôs processos para essa OAB.',
        total,
      });

      return {
        processos: hits.map(h => {
          const mapped = this.mapearProcesso(h);
          return {
            numeroProcesso: mapped.numeroProcesso,
          tribunalCodigo: this.codigo,
            classe: mapped.classe,
            classeCodigo: mapped.classeCodigo,
            assunto: mapped.assunto,
            assuntoPrincipal: mapped.assuntoPrincipal,
            dataAjuizamento: h._source.dataAjuizamento,
            orgaoJulgador: mapped.orgaoJulgador,
            orgaoJulgadorCodigo: mapped.orgaoJulgadorCodigo,
            valorCausa: typeof h._source.valorCausa === 'string'
            ? parseFloat(h._source.valorCausa.replace(/\./g, '').replace(',', '.'))
            : h._source.valorCausa,
            instancia: mapped.instancia,
            formato: mapped.formato,
            sistema: mapped.sistema,
            partes: mapped.partes,
            advogados: this.extrairAdvogados(mapped.partes),
            movimentacoes: mapped.movimentacoes,
          };
        }),
        total,
        fontes: sourceLogs,
      };
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new Error('DATAJUD_API_KEY inválida ou expirada');
      }
      if (error.response?.status === 429) {
        throw new Error('Rate limit DataJud excedido');
      }
      logger.error(`DataJudAdapter[${this.codigo}] erro ao buscar por OAB:`, { oab, erro: error.message });
      sourceLogs.push({
        fonte: 'datajud',
        status: 'error',
        tribunalCodigo: this.codigo,
        url: this.baseUrl,
        mensagem: error.message,
        total: 0,
      });
      return { processos: [], total: 0, fontes: sourceLogs };
    }
  }

  private normalizarTexto(value?: string): string {
    return (value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private processoTemAdvogado(src: DataJudProcesso, oabNumero: string, nome?: string, uf?: string): boolean {
    const nomeBusca = this.normalizarTexto(nome);
    const nomeTokens = nomeBusca.split(' ').filter(Boolean);

    return (src.polo || []).some(polo =>
      (polo.advogados || []).some(adv => {
        const numeroOk = String(adv.numeroOAB || '').replace(/\D/g, '') === oabNumero;
        const ufOk = !uf || String(adv.ufOAB || '').toUpperCase() === uf;
        const nomeAdv = this.normalizarTexto(adv.nome);
        const nomeOk = nomeTokens.length === 0 || nomeTokens.every(token => nomeAdv.includes(token));

        return numeroOk && ufOk && nomeOk;
      })
    );
  }

  private extrairAdvogados(partes: DadosParte[]): DadosAdvogado[] {
    const seen = new Set<string>();
    const advogados: DadosAdvogado[] = [];

    for (const parte of partes) {
      for (const adv of parte.advogados || []) {
        const key = `${this.normalizarTexto(adv.nome)}:${adv.numeroOAB || ''}:${adv.ufOAB || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        advogados.push(adv);
      }
    }

    return advogados;
  }

  private headersEsaj(): Record<string, string> {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    };
  }

  private numeroFormatado(numero: string): string {
    const clean = this.formatarNumeroProcesso(numero);
    if (clean.length !== 20) return numero;
    return `${clean.slice(0, 7)}-${clean.slice(7, 9)}.${clean.slice(9, 13)}.${clean.slice(13, 14)}.${clean.slice(14, 16)}.${clean.slice(16)}`;
  }

  private parseDataEsaj(value: string): Date | undefined {
    const match = value.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+às\s+(\d{2}):(\d{2}))?/);
    if (!match) return undefined;
    const [, dd, mm, yyyy, hh = '00', min = '00'] = match;
    const parsed = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min));
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private parseValorEsaj(value: string): number | undefined {
    const match = value.match(/R\$\s*([\d.]+,\d{2})/);
    if (!match) return undefined;
    const parsed = Number(match[1].replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private async getEsajHtml(url: string): Promise<string> {
    const response = await axios.get<string>(url, {
      timeout: 30000,
      maxRedirects: 5,
      headers: this.headersEsaj(),
    });
    return response.data;
  }

  private extrairProcessosEsaj(html: string): EsajProcessoResumo[] {
    const $ = cheerio.load(html);
    const processos = new Map<string, EsajProcessoResumo>();

    $('a[href*="show.do"]').each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      const href = $(el).attr('href') || '';
      const numero = text.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/)?.[0];
      if (!numero) return;
      const urlDetalhe = href.startsWith('http') ? href : `${ESAJ_TJSP_BASE_URL}${href}`;
      this.esajDetailUrlByNumero.set(this.formatarNumeroProcesso(numero), urlDetalhe);
      processos.set(numero, { numeroProcesso: numero, urlDetalhe });
    });

    return Array.from(processos.values());
  }

  private extrairPaginasEsaj(html: string): number[] {
    const $ = cheerio.load(html);
    const paginas = new Set<number>([1]);

    $('a[href*="paginaConsulta="]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const match = href.match(/paginaConsulta=(\d+)/);
      if (match) paginas.add(Number(match[1]));
    });

    return Array.from(paginas).filter(Number.isFinite).sort((a, b) => a - b);
  }

  private async buscarPorOABEsajTJSP(oabNumero: string, nome?: string): Promise<ResultadoBusca> {
    const baseSearch = `${ESAJ_TJSP_BASE_URL}/cpopg/search.do?conversationId=&cbPesquisa=NUMOAB&dadosConsulta.valorConsulta=${encodeURIComponent(oabNumero)}&cdForo=-1`;
    const primeiraPagina = await this.getEsajHtml(baseSearch);
    const paginas = this.extrairPaginasEsaj(primeiraPagina);
    const processos = new Map<string, EsajProcessoResumo>();

    for (const item of this.extrairProcessosEsaj(primeiraPagina)) {
      processos.set(item.numeroProcesso, item);
    }

    for (const pagina of paginas.filter(p => p !== 1)) {
      const pageUrl = `${ESAJ_TJSP_BASE_URL}/cpopg/trocarPagina.do?paginaConsulta=${pagina}&conversationId=&cbPesquisa=NUMOAB&dadosConsulta.valorConsulta=${encodeURIComponent(oabNumero)}&cdForo=-1`;
      try {
        const html = await this.getEsajHtml(pageUrl);
        for (const item of this.extrairProcessosEsaj(html)) {
          processos.set(item.numeroProcesso, item);
        }
      } catch (error) {
        logger.warn(`DataJudAdapter[${this.codigo}] erro ao buscar página ${pagina} do ESAJ para OAB ${oabNumero}: ${(error as Error).message}`);
      }
    }

    let itens = Array.from(processos.values());

    if (nome?.trim()) {
      const nomeBusca = this.normalizarTexto(nome);
      const filtrados: EsajProcessoResumo[] = [];
      for (const item of itens) {
        const detalhe = await this.buscarProcessoEsajTJSP(item.numeroProcesso, item.urlDetalhe);
        const advogados = this.extrairAdvogados(detalhe?.partes || []);
        if (advogados.some(adv => this.normalizarTexto(adv.nome).includes(nomeBusca))) {
          filtrados.push(item);
        }
      }
      itens = filtrados;
    }

    return {
      processos: itens.map(item => ({
        numeroProcesso: this.formatarNumeroProcesso(item.numeroProcesso),
        tribunalCodigo: this.codigo,
      })),
      total: itens.length,
    };
  }

  private async buscarProcessoEsajTJSP(numeroProcesso: string, urlDetalhe?: string): Promise<DadosProcesso | null> {
    const numeroFormatado = this.numeroFormatado(numeroProcesso);
    const url = urlDetalhe
      || this.esajDetailUrlByNumero.get(this.formatarNumeroProcesso(numeroProcesso))
      || `${ESAJ_TJSP_BASE_URL}/cpopg/search.do?conversationId=&cbPesquisa=NUMPROC&dadosConsulta.valorConsulta=${encodeURIComponent(numeroFormatado)}&cdForo=-1`;

    try {
      const html = await this.getEsajHtml(url);
      const $ = cheerio.load(html);
      const numero = $('#numeroProcesso').text().replace(/\s+/g, ' ').trim() || numeroFormatado;
      const orgao = [$('#foroProcesso').text(), $('#varaProcesso').text()]
        .map(v => v.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' - ');

      const partes: DadosParte[] = [];
      $('#tablePartesPrincipais tr').each((_, row) => {
        const tipoRaw = $(row).find('.tipoDeParticipacao').first().text().replace(/\s+/g, ' ').trim();
        const cell = $(row).find('.nomeParteEAdvogado').first();
        const cellClone = cell.clone();
        cellClone.find('br').replaceWith('\n');
        const lines = cellClone.text().split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
        const nomeParte = lines.find(line => !/^Advogad[oa]:/i.test(line));
        if (!nomeParte) return;

        const advogados: DadosAdvogado[] = [];
        cell.find('.mensagemExibindo').each((_, label) => {
          const labelText = $(label).text().replace(/\s+/g, ' ').trim();
          if (!/^Advogad[oa]:/i.test(labelText)) return;
          const parentText = $(label).parent().text().replace(/\s+/g, ' ').trim();
          const nomeAdv = parentText.replace(/^Advogad[oa]:\s*/i, '').trim();
          if (nomeAdv) advogados.push({ nome: nomeAdv });
        });

        partes.push({
          nome: nomeParte,
          tipo: this.mapearTipoParteEsaj(tipoRaw),
          isAdvogado: false,
          advogados: advogados.length > 0 ? advogados : undefined,
        });
      });

      const movimentacoes: DadosMovimentacao[] = [];
      $('#tabelaTodasMovimentacoes tr.containerMovimentacao').each((_, row) => {
        const dataText = $(row).find('.dataMovimentacao').text().replace(/\s+/g, ' ').trim();
        const data = this.parseDataEsaj(dataText);
        if (!data) return;
        const descricao = $(row).find('.descricaoMovimentacao').text().replace(/\s+/g, ' ').trim();
        if (!descricao) return;
        movimentacoes.push({
          data,
          descricao,
          origem: orgao || this.codigo,
          dadosOriginais: { fonte: 'esaj-tjsp', dataText },
        });
      });

      return {
        numeroProcesso: this.formatarNumeroProcesso(numero),
        tribunalCodigo: this.codigo,
        classe: $('#classeProcesso').text().replace(/\s+/g, ' ').trim() || undefined,
        assunto: $('#assuntoProcesso').text().replace(/\s+/g, ' ').trim() || undefined,
        assuntoPrincipal: $('#assuntoProcesso').text().replace(/\s+/g, ' ').trim() || undefined,
        instancia: 'PRIMEIRA',
        dataDistribuicao: this.parseDataEsaj($('#dataHoraDistribuicaoProcesso').text()),
        dataAjuizamento: this.parseDataEsaj($('#dataHoraDistribuicaoProcesso').text()),
        valorCausa: this.parseValorEsaj($('#valorAcaoProcesso').text()),
        orgaoJulgador: orgao || undefined,
        sistema: 'e-SAJ',
        formato: 'Eletrônico',
        partes,
        movimentacoes,
        urlPortal: url,
        dadosOriginais: { fonte: 'esaj-tjsp' },
      };
    } catch (error) {
      logger.warn(`DataJudAdapter[${this.codigo}] erro ao buscar detalhes ESAJ ${numeroProcesso}: ${(error as Error).message}`);
      return null;
    }
  }

  private mapearTipoParteEsaj(tipo: string): DadosParte['tipo'] {
    const normalized = this.normalizarTexto(tipo);
    if (/autor|reqte|requerente|exeqte|exequente|exequdo|justica publica/.test(normalized)) return 'AUTOR';
    if (/reu|reqdo|requerido|executado|exectdo|apelado|agravado/.test(normalized)) return 'REU';
    if (/advogad/.test(normalized)) return 'ADVOGADO';
    return 'OUTRO';
  }

  private async mesclarComDetalhesEsaj(processo: DadosProcesso, numeroProcesso: string): Promise<DadosProcesso> {
    const detalhes = await this.buscarProcessoEsajTJSP(numeroProcesso);
    if (!detalhes) return processo;

    return {
      ...processo,
      classe: detalhes.classe || processo.classe,
      assunto: detalhes.assunto || processo.assunto,
      assuntoPrincipal: detalhes.assuntoPrincipal || processo.assuntoPrincipal,
      dataDistribuicao: detalhes.dataDistribuicao || processo.dataDistribuicao,
      dataAjuizamento: detalhes.dataAjuizamento || processo.dataAjuizamento,
      valorCausa: detalhes.valorCausa ?? processo.valorCausa,
      orgaoJulgador: detalhes.orgaoJulgador || processo.orgaoJulgador,
      sistema: detalhes.sistema || processo.sistema,
      formato: detalhes.formato || processo.formato,
      partes: detalhes.partes.length > 0 ? detalhes.partes : processo.partes,
      movimentacoes: detalhes.movimentacoes.length > 0 ? detalhes.movimentacoes : processo.movimentacoes,
      urlPortal: detalhes.urlPortal || processo.urlPortal,
      dadosOriginais: {
        ...processo.dadosOriginais,
        esaj: detalhes.dadosOriginais,
      },
    };
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

  private gerarMockResultadoOAB(_oab: string): ResultadoBusca {
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

export { DATAJUD_TRIBUNAIS } from '../config/datajudSiglas';
