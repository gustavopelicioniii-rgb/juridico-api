/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * TJMG Direct Crawler - Acesso sem CAPTCHA
 *
 * Descoberta critica:
 * - O TJMG NAO usa CAPTCHA quando acessado diretamente via URL
 * - URL direta: proc_resultado_oab.jsp com parametros corretos
 * - Parametro tipoConsulta=4 indica busca por OAB
 * - Nao precisa de Puppeteer - GET direto funciona!
 *
 * Fontes de dados TJMG:
 * 1. LEGACY (proc_resultado_oab.jsp) - busca por OAB
 * 2. PJe (www8.tjmg.jus.br) - sistema novo
 * 3. DataJud - API publica CNJ ( fallback )
 */

import puppeteer from 'puppeteer-extra';
import type { Browser, Page } from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import logger from '../config/logger';

puppeteer.use(StealthPlugin());

interface TJMGProcesso {
  numeroProcesso: string;
  classe: string;
  comarca: string;
  natureza: string;
  situacao: string;
  distribuicao?: string;
  ultimaMovimentacao?: string;
  advogado: string;
  oab: string;
}

interface TJMGBuscaResult {
  processos: TJMGProcesso[];
  total: number;
  oab: string;
  fonte: 'datajud' | 'legacy' | 'pje';
}

class TJMGDirectCrawler {
  private browser: Browser | null = null;
  private readonly baseUrlLegacy = 'https://www4.tjmg.jus.br/juridico/sf';
  private readonly baseUrlPJe = 'https://www8.tjmg.jus.br/Processo_Eletronico_TJMG';

  async getBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920x1080',
        ],
      });
    }
    return this.browser;
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  private parseOAB(oab: string): { numero: string; tipo: string; uf: string } {
    const match = oab.match(/^(\d+)\s*([A-Z]?)\s*([A-Z]{2})$/i);
    if (match) {
      return { numero: match[1], tipo: match[2] || 'N', uf: match[3].toUpperCase() };
    }
    const parts = oab.trim().split(/\s+/);
    return {
      numero: parts[0] || oab.replace(/\D/g, ''),
      tipo: parts[1] || 'N',
      uf: parts[2] || 'MG',
    };
  }

  /**
   * Estrategia 1: DataJud (preferencial - API publica CNJ)
   */
  async buscarPorOABDataJud(oab: string): Promise<TJMGBuscaResult> {
    const { numero } = this.parseOAB(oab);

    logger.info(`[TJMG] Buscando OAB ${oab} via DataJud...`);

    try {
      const apiKey = process.env.DATAJUD_API_KEY;
      const response = await fetch(
        'https://api-publica.datajud.cnj.jus.br/api_publica_tjmg/_search',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `APIKey ${apiKey}`,
          },
          body: JSON.stringify({
            query: {
              bool: {
                should: [
                  { wildcard: { numeroProcesso: `*${numero}*` } },
                ],
              },
            },
            size: 100,
            sort: [{ dataAjuizamento: { order: 'desc' } }],
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`DataJud returned ${response.status}`);
      }

      const data: any = await response.json();
      const hits = data?.hits?.hits || [];

      if (hits.length > 0) {
        return {
          processos: hits.map((hit: any) => {
            const src = hit._source;
            return {
              numeroProcesso: src.numeroProcesso,
              classe: src.classe || '',
              comarca: src.orgaoJulgador || '',
              natureza: '',
              situacao: '',
              distribuicao: src.dataAjuizamento,
              ultimaMovimentacao: src.ultimaMovimentacao,
              advogado: oab,
              oab,
            };
          }),
          total: hits.length,
          oab,
          fonte: 'datajud',
        };
      }
    } catch (error: any) {
      logger.warn(`[TJMG] DataJud falhou: ${error.message}`);
    }

    return { processos: [], total: 0, oab, fonte: 'datajud' };
  }

  /**
   * Estrategia 2: LEGACY DIRECT - Acesso via URL sem CAPTCHA
   *
   * Descoberta: O TJMG nao usa CAPTCHA quando acessamos diretamente
   * a URL de resultado com os parametros corretos.
   *
   * URL base: proc_resultado_oab.jsp
   * Parametros criticos:
   * - tipoConsulta=4 (busca por OAB)
   * - codigoOAB=<numero OAB>
   * - tipoOAB=N (tipo normal)
   * - ufOAB=MG
   * - ativoBaixado=X (ativos e baixados)
   * - natureza=0 (todas naturezas)
   * - comrCodigo=<codigo comarca>
   * - dataExpediente=null (sem filtro de data)
   * - paginacao=S (paginar resultados)
   * - linhasPorPagina=10
   */
  async buscarLegacyDireto(oab: string, comarca: string = '0'): Promise<TJMGBuscaResult> {
    const { numero, tipo, uf } = this.parseOAB(oab);

    logger.info(`[TJMG] Buscando OAB ${oab} via Legacy (comarca ${comarca})...`);

    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
      );

      // Construir URL de resultado diretamente (SEM passar pelo formulario!)
      const params = new URLSearchParams({
        ativoBaixado: 'X',
        codigoOAB: numero,
        comrCodigo: comarca,
        dataExpediente: 'null',
        linhasPorPagina: '50',
        natureza: '0',
        nomeAdvogado: '',
        numero: '1',
        paginacao: 'S',
        paginaNumero: '1',
        tipoConsulta: '4', // 4 = busca por OAB
        tipoOAB: tipo,
        ufOAB: uf,
      });

      const url = `${this.baseUrlLegacy}/proc_resultado_oab.jsp?${params.toString()}`;
      logger.info(`[TJMG] URL: ${url.substring(0, 120)}...`);

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));

      // Verificar se tem CAPTCHA
      const hasCaptcha = await page.evaluate(() => {
        const doc = (globalThis as any).document;
        return doc.body.innerText.toLowerCase().includes('captcha');
      });

      if (hasCaptcha) {
        logger.warn('[TJMG] CAPTCHA detectado - fallback');
        return { processos: [], total: 0, oab, fonte: 'legacy' };
      }

      // Extrair resultados
      const resultado = await this.extrairResultadosLegacy(page);

      logger.info(`[TJMG] Legacy encontrou ${resultado.total} processos`);

      return {
        processos: resultado.processos.map(p => ({ ...p, advogado: oab, oab })),
        total: resultado.total,
        oab,
        fonte: 'legacy',
      };

    } catch (error: any) {
      logger.error(`[TJMG] Erro no Legacy: ${error.message}`);
      return { processos: [], total: 0, oab, fonte: 'legacy' };
    } finally {
      await page.close();
    }
  }

  /**
   * Extrai resultados da pagina legacy
   */
  private async extrairResultadosLegacy(page: Page): Promise<{ processos: TJMGProcesso[]; total: number }> {
    return page.evaluate(() => {
      const doc = (globalThis as any).document;
      const bodyText = doc.body.innerText;

      // Extrair total
      const totalMatch = bodyText.match(/Processos encontrados[:\s]*(\d+)/i);
      const total = totalMatch ? parseInt(totalMatch[1]) : 0;

      // Extrair linhas de processo
      const linhas = bodyText.match(/PROCESSO\s*:\s*[\d.\-]+/gi) || []; // eslint-disable-line no-useless-escape

      const processos: TJMGProcesso[] = [];
      const seen = new Set();

      linhas.forEach((linha: string) => {
        const numMatch = linha.match(/PROCESSO\s*:\s*([\d.\-]+)/i); // eslint-disable-line no-useless-escape
        const classeMatch = linha.match(/Classe:\s*([^\n]+)/i);
        const distMatch = linha.match(/Distribui[çc][ãa]o:\s*([^\n]+)/i);
        const movMatch = linha.match(/ltima Movimenta[çc][ãa]o:\s*([^\n]+)/i);

        if (numMatch) {
          const num = numMatch[1].replace(/\D/g, '');
          if (!seen.has(num) && num.length >= 7) {
            seen.add(num);
            processos.push({
              numeroProcesso: num,
              classe: classeMatch ? classeMatch[1].trim().substring(0, 80) : '',
              comarca: '',
              natureza: '',
              situacao: linha.includes('BAIXADO') ? 'BAIXADO' : 'ATIVO',
              distribuicao: distMatch ? distMatch[1].trim() : '',
              ultimaMovimentacao: movMatch ? movMatch[1].trim() : '',
              advogado: '',
              oab: '',
            });
          }
        }
      });

      // Se nao encontrou via regex, buscar numeros no formato
      if (processos.length === 0) {
        const nums = bodyText.match(/\d{7}[\d.\-]+/g) || []; // eslint-disable-line no-useless-escape
        const unique = [...new Set(nums.map((n: string) => n.replace(/\D/g, '')))] as string[];
        unique.forEach((num: string) => {
          if (num.length >= 7) {
            processos.push({
              numeroProcesso: num,
              classe: '',
              comarca: '',
              natureza: '',
              situacao: '',
              advogado: '',
              oab: '',
            });
          }
        });
      }

      return { processos, total };
    });
  }

  /**
   * Estrategia 3: PJe TJMG
   */
  async buscarPJe(oab: string): Promise<TJMGBuscaResult> {
    logger.info(`[TJMG] Tentando PJe para OAB ${oab}...`);

    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
      );

      // Tentar acesso ao PJe
      const url = `${this.baseUrlPJe}/consulta-advogado.seam?oab=${oab.replace(/\s/g, '')}`;

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
      await new Promise(r => setTimeout(r, 3000));

      const hasCaptcha = await page.evaluate(() => {
        const doc = (globalThis as any).document;
        return doc.body.innerText.toLowerCase().includes('captcha');
      });

      if (hasCaptcha) {
        logger.warn('[TJMG] PJe tem CAPTCHA');
        return { processos: [], total: 0, oab, fonte: 'pje' };
      }

      // Extrair resultados do PJe
      const processos = await page.evaluate(() => {
        const doc = (globalThis as any).document;
        const results: TJMGProcesso[] = [];
        const links = doc.querySelectorAll('a[href*="processo"]');

        links.forEach((link: any) => {
          const text = link.textContent || '';
          const numMatch = text.match(/\d{7,}/);
          if (numMatch) {
            results.push({
              numeroProcesso: numMatch[0].replace(/\D/g, ''),
              classe: '',
              comarca: '',
              natureza: '',
              situacao: '',
              advogado: oab,
              oab,
            });
          }
        });

        return results;
      });

      return {
        processos,
        total: processos.length,
        oab,
        fonte: 'pje',
      };

    } catch (error: any) {
      logger.error(`[TJMG] PJe erro: ${error.message}`);
      return { processos: [], total: 0, oab, fonte: 'pje' };
    } finally {
      await page.close();
    }
  }

  /**
   * Busca principal - tenta todas as fontes
   */
  async buscarPorOAB(oab: string, comarca: string = '0'): Promise<TJMGBuscaResult> {
    logger.info(`[TJMG] Busca OAB ${oab} (comarca ${comarca})`);

    // 1. PRIORIDADE: Legacy direto (mais confiavel)
    const resultadoLegacy = await this.buscarLegacyDireto(oab, comarca);
    if (resultadoLegacy.total > 0) {
      logger.info(`[TJMG] Legacy retornou ${resultadoLegacy.total} processos`);
      return resultadoLegacy;
    }

    // 2. SEGUNDA: DataJud
    const resultadoDataJud = await this.buscarPorOABDataJud(oab);
    if (resultadoDataJud.total > 0) {
      logger.info(`[TJMG] DataJud retornou ${resultadoDataJud.total} processos`);
      return resultadoDataJud;
    }

    // 3. TERCEIRA: PJe
    const resultadoPJe = await this.buscarPJe(oab);
    if (resultadoPJe.total > 0) {
      logger.info(`[TJMG] PJe retornou ${resultadoPJe.total} processos`);
      return resultadoPJe;
    }

    logger.warn(`[TJMG] Nenhuma fonte retornou resultados para OAB ${oab}`);
    return { processos: [], total: 0, oab, fonte: 'legacy' };
  }

  /**
   * Busca detalhes de um processo especifico no TJMG
   */
  async buscarDetalhesProcesso(numeroProcesso: string): Promise<any> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setViewport({ width: 1920, height: 1080 });

      const numFormatado = numeroProcesso.replace(/\D/g, '');
      const url = `${this.baseUrlLegacy}/proc_processo.jsp?proc_numero=${numFormatado}`;

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));

      return await page.evaluate(() => {
        const doc = (globalThis as any).document;
        const result: any = {
          numeroProcesso: '',
          partes: [],
          movimentacoes: [],
        };

        const numEl = doc.querySelector('[class*="numero"]');
        if (numEl) result.numeroProcesso = numEl.textContent?.replace(/\D/g, '') || '';

        const classeEl = doc.querySelector('[class*="classe"]');
        if (classeEl) result.classe = classeEl.textContent?.trim() || '';

        // Partes
        const poloAtivo = doc.querySelectorAll('#poloAtivo td, .poloAtivo td');
        poloAtivo.forEach((el: any) => {
          const texto = el.textContent?.trim() || '';
          if (texto.length > 3) {
            result.partes.push({ nome: texto, tipo: 'AUTOR' });
          }
        });

        const poloPassivo = doc.querySelectorAll('#poloPassivo td, .poloPassivo td');
        poloPassivo.forEach((el: any) => {
          const texto = el.textContent?.trim() || '';
          if (texto.length > 3) {
            result.partes.push({ nome: texto, tipo: 'REU' });
          }
        });

        // Movimentacoes
        const movRows = doc.querySelectorAll('#moviment table tr, .movimentacao tr');
        movRows.forEach((row: any) => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const data = cells[0].textContent?.trim() || '';
            const desc = cells[1].textContent?.trim() || '';
            if (data && desc) {
              result.movimentacoes.push({ data, descricao: desc });
            }
          }
        });

        return result;
      });
    } catch (error: any) {
      logger.error(`[TJMG] Erro ao buscar detalhes: ${error.message}`);
      return null;
    } finally {
      await page.close();
    }
  }
}

export default new TJMGDirectCrawler();
