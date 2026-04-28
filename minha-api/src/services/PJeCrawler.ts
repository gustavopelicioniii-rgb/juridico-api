/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PJe Crawler - TJSP PJe (Sistema de Juizados Especiais)
 *
 * O PJe tem uma estrutura diferente do e-SAJ.
 * Usa autenticação e consultas mais complexas.
 *
 * Busca por OAB: consulta processos vinculados ao advogado
 */

import puppeteer from 'puppeteer-extra';
import type { Browser, Page } from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import logger from '../config/logger';

puppeteer.use(StealthPlugin());

interface PJEDadosCompletos {
  numeroProcesso: string;
  partes: Array<{
    nome: string;
    tipo: 'AUTOR' | 'REU' | 'OUTRO';
    advogados?: string[];
  }>;
  valorCausa?: number;
  ultimaMovimentacao?: string;
  classe?: string;
  assunto?: string;
  orgao?: string;
}

interface PJeBuscaResult {
  processos: Array<{
    numeroProcesso: string;
    classe: string;
    orgao: string;
    dataAjuizamento: string;
  }>;
  total: number;
}

class PJeCrawler {
  private browser: Browser | null = null;
  private readonly baseUrl = 'https://pje.tjsp.jus.br';
  private timeout = 30000;

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

  /**
   * Busca processos por OAB no PJe
   */
  async buscarPorOAB(oab: string): Promise<PJeBuscaResult> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
      );

      logger.info(`PJe Crawler: buscando OAB ${oab}`);

      // PJe usa consulta pública via URL com parâmetros
      const oabNumero = oab.replace(/\D/g, '').slice(0, 6);
      const oabUf = oab.replace(/\D/g, '').slice(-2).toUpperCase();

      // URLs públicas do PJe para consulta
      const urls = [
        `${this.baseUrl}/pje/consulta/publica/consultaProcesso.xhtml`,
        `${this.baseUrl}/pje/consulta/consultaProcesso弹性search.xhtml`,
      ];

      let loaded = false;
      for (const url of urls) {
        try {
          await page.goto(url, { waitUntil: 'networkidle2', timeout: this.timeout });
          loaded = true;
          break;
        } catch { /* next */ }
      }

      if (!loaded) {
        logger.warn('PJe Crawler: não conseguiu acessar portal');
        return { processos: [], total: 0 };
      }

      await new Promise(r => setTimeout(r, 2000));

      // Preencher campo OAB
      const filled = await page.evaluate((oabStr: string) => {
        const doc = globalThis as any;
        const selectors = [
          'input[name*="oab"]',
          'input[id*="oab"]',
          'input[name*="advogado"]',
          'input[id*="advogado"]',
          'input[placeholder*="OAB"]',
          'input[placeholder*="advogado"]',
        ];
        for (const sel of selectors) {
          const input = doc.querySelector(sel);
          if (input) {
            input.value = oabStr.replace(/\s/g, '').toUpperCase();
            return true;
          }
        }
        return false;
      }, oab);

      if (!filled) {
        // Tentaratar mediante click em radio/tipo de busca
        await page.evaluate(() => {
          const doc = globalThis as any;
          const radios = doc.querySelectorAll('input[type="radio"]');
          radios.forEach((r: any) => {
            const lbl = r.closest('label');
            if (lbl?.textContent?.toLowerCase().includes('oab')) {
              r.checked = true;
            }
          });
        });
        await new Promise(r => setTimeout(r, 500));

        // Tentar preencher de novo
        await page.evaluate((oabStr: string) => {
          const doc = globalThis as any;
          const allInputs = doc.querySelectorAll('input[type="text"]');
          allInputs.forEach((inp: any) => {
            const name = inp.name?.toLowerCase() || '';
            const id = inp.id?.toLowerCase() || '';
            const ph = inp.placeholder?.toLowerCase() || '';
            if (name.includes('oab') || id.includes('oab') || ph.includes('oab')) {
              inp.value = oabStr.replace(/\s/g, '').toUpperCase();
            }
          });
        }, oab);
      }

      // Clicar buscar
      await page.evaluate(() => {
        const doc = globalThis as any;
        const btns = Array.from(doc.querySelectorAll('button, input[type="submit"]'));
        btns.forEach((b: any) => {
          const txt = b.textContent?.toLowerCase() || '';
          const val = b.value?.toLowerCase() || '';
          if (txt.includes('buscar') || val.includes('buscar') ||
              txt.includes('pesquisar') || val.includes('pesquisar')) {
            b.click();
          }
        });
      });

      await new Promise(r => setTimeout(r, 4000));
      await page.waitForSelector('table, .resultado, [id*="resultado"]', { timeout: 10000 }).catch(() => null);

      const resultados = await this.extrairResultados(page);
      logger.info(`PJe Crawler: OAB ${oab} retornou ${resultados.length} processos`);

      return { processos: resultados, total: resultados.length };
    } catch (error: any) {
      logger.error(`PJe Crawler: erro ao buscar OAB ${oab}: ${error.message}`);
      return { processos: [], total: 0 };
    } finally {
      await page.close();
    }
  }

  /**
   * Busca detalhes de um processo específico no PJe
   */
  async buscarDetalhesProcesso(numeroProcesso: string): Promise<PJEDadosCompletos | null> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
      );

      const numFormatado = numeroProcesso.replace(/\D/g, '');
      const urls = [
        `${this.baseUrl}/pje/consulta/publica/consultaProcesso.xhtml?processo=${numFormatado}`,
        `${this.baseUrl}/pje/consulta/processo/${numFormatado}`,
      ];

      let loaded = false;
      for (const url of urls) {
        try {
          await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
          loaded = true;
          break;
        } catch { /* next */ }
      }

      if (!loaded) return null;
      await new Promise(r => setTimeout(r, 2000));

      return await this.extrairDadosProcesso(page);
    } catch (error: any) {
      logger.error(`PJe Crawler: erro ao buscar detalhes ${numeroProcesso}: ${error.message}`);
      return null;
    } finally {
      await page.close();
    }
  }

  private async extrairResultados(page: Page): Promise<PJeBuscaResult['processos']> {
    return page.evaluate(() => {
      const doc = globalThis as any;
      const resultados: any[] = [];

      const rows = doc.querySelectorAll('table tbody tr, .resultado tr, [class*="processo"]');
      rows.forEach((row: any) => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 3) {
          const numeroEl = cells[0].querySelector('a, span');
          const numero = numeroEl?.textContent?.trim() || '';
          if (numero.match(/\d{7,}/)) {
            resultados.push({
              numeroProcesso: numero.replace(/\D/g, ''),
              classe: cells[1]?.textContent?.trim() || '',
              orgao: cells[2]?.textContent?.trim() || '',
              dataAjuizamento: cells[3]?.textContent?.trim() || '',
            });
          }
        }
      });

      if (resultados.length === 0) {
        const links = doc.querySelectorAll('a[href*="processo"], a[href*="pje"]');
        links.forEach((link: any) => {
          const texto = link.textContent?.trim() || '';
          if (texto.match(/\d{7,}/)) {
            resultados.push({
              numeroProcesso: texto.replace(/\D/g, ''),
              classe: '',
              orgao: '',
              dataAjuizamento: '',
            });
          }
        });
      }

      return resultados;
    });
  }

  private async extrairDadosProcesso(page: Page): Promise<PJEDadosCompletos | null> {
    return page.evaluate(() => {
      const doc = globalThis as any;
      const resultado: PJEDadosCompletos = { numeroProcesso: '', partes: [] };

      // Número do processo
      const numeroEl = doc.querySelector(
        '[class*="numeroProcesso"], [id*="numeroProcesso"], [class*="processo"] span:first-child'
      );
      resultado.numeroProcesso = numeroEl?.textContent?.trim().replace(/\D/g, '') || '';

      // Classe
      const classeEl = doc.querySelector('[class*="classe"], [id*="classe"]');
      resultado.classe = classeEl?.textContent?.trim() || '';

      // Órgão
      const orgaoEl = doc.querySelector('[class*="orgao"], [id*="orgao"]');
      resultado.orgao = orgaoEl?.textContent?.trim() || '';

      // Valor
      const valorEl = doc.querySelector('[class*="valor"], [id*="valor"]');
      if (valorEl) {
        const valorTexto = valorEl.textContent?.trim() || '';
        const valorNum = parseFloat(
          valorTexto.replace(/\./g, '').replace(',', '.').replace(/[^\d,]/g, '')
        );
        if (!isNaN(valorNum)) resultado.valorCausa = valorNum;
      }

      // Partes
      const parteEls = doc.querySelectorAll('[class*="parte"], [class*="polo"]');
      parteEls.forEach((p: any) => {
        const nomeEl = p.querySelector('span, strong, [class*="nome"]');
        const nome = nomeEl?.textContent?.trim() || '';
        if (nome && nome.length > 3) {
          const tipo = p.textContent?.toLowerCase().includes('ativo') ||
                       p.textContent?.toLowerCase().includes('autor') ? 'AUTOR' : 'REU';
          resultado.partes.push({ nome, tipo });
        }
      });

      // Movimentações
      const movs = doc.querySelectorAll('[class*="movimentacao"] tr, [class*="andamento"]');
      if (movs.length > 0) {
        resultado.ultimaMovimentacao = movs[0].textContent?.trim() || '';
      }

      return resultado;
    });
  }
}

export default new PJeCrawler();
