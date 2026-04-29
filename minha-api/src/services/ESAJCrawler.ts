/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ESAJ Crawler - Complementa dados do DataJud via portal e-SAJ
 *
 * O DataJud não expõe: partes (autor/réu), advogados, valor da causa.
 * Este crawler busca essas informações diretamente no portal e-SAJ:
 *   https://esaj.tjsp.jus.br/cpopg/show.do
 *
 * Busca por OAB: pesquisa processos onde o advogado está cadastrado
 *
 * AGORA SUPORTA MÚLTIPLOS TRIBUNAIS - cada tribunal tem seu próprio baseUrl
 */

import puppeteer from 'puppeteer-extra';
import type { Browser, Page } from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import RecaptchaPlugin from 'puppeteer-extra-plugin-recaptcha';
import logger from '../config/logger';
import { getCrawlerConfig } from '../config/tribunalCrawlers';
import { CaptchaHandler, tribunalExigeCaptcha } from './CaptchaHandler';
import { registry } from '../tribunais';
import { CrawlerObserver } from './CrawlerObserver';

puppeteer.use(StealthPlugin());
puppeteer.use(RecaptchaPlugin());

interface ESAJDadosCompletos {
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

interface ESAJBuscaResult {
  processos: Array<{
    numeroProcesso: string;
    classe: string;
    orgao: string;
    dataAjuizamento: string;
    nome?: string;
  }>;
  total: number;
}

export interface ESAJCrawlerOptions {
  tribunalCodigo?: string;
  baseUrl?: string;
}

class ESAJCrawler {
  private browser: Browser | null = null;
  private baseUrl: string;
  private timeout = 30000;
  private tribunalCodigo: string;
  private usarCaptcha: boolean;

  constructor(options: ESAJCrawlerOptions = {}) {
    this.tribunalCodigo = options.tribunalCodigo || 'TJSP';

    if (options.baseUrl) {
      this.baseUrl = options.baseUrl;
    } else {
      const config = getCrawlerConfig(this.tribunalCodigo);
      this.baseUrl = config?.baseUrl || 'https://esaj.tjsp.jus.br';
    }

    this.usarCaptcha = tribunalExigeCaptcha(this.tribunalCodigo);
  }

  /**
   * Factory method para criar crawler para um tribunal específico
   */
  static forTribunal(tribunalCodigo: string): ESAJCrawler {
    return new ESAJCrawler({ tribunalCodigo });
  }

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
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
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
   * Tenta resolver CAPTCHA se presente
   */
  private async verificarCaptcha(page: Page): Promise<boolean> {
    if (!this.usarCaptcha) return true;

    const captchaHandler = new CaptchaHandler(page, this.tribunalCodigo);
    const resultado = await captchaHandler.detectarEResolver();

    if (resultado.resolvido) {
      logger.info(`[ESAJ Crawler] CAPTCHA resolvido para ${this.tribunalCodigo}`);
      return true;
    }

    logger.warn(`[ESAJ Crawler] CAPTCHA não resolvido para ${this.tribunalCodigo}: ${resultado.erro}`);
    return false;
  }

  /**
   * Fallback: tenta buscar via DataJud quando crawler falha
   */
  private async fallbackDataJud(oab: string, nome?: string): Promise<ESAJBuscaResult> {
    logger.info(`[ESAJ Crawler] Tentando fallback DataJud para OAB ${oab}${nome ? ` + nome "${nome}"` : ''}`);

    try {
      const adapter = registry.get(this.tribunalCodigo);
      if (!adapter) {
        return { processos: [], total: 0 };
      }

      const resultado = await adapter.buscarPorOAB(oab, nome);

      return {
        processos: resultado.processos.map(p => ({
          numeroProcesso: p.numeroProcesso,
          classe: '',
          orgao: '',
          dataAjuizamento: '',
        })),
        total: resultado.total,
      };
    } catch (error: any) {
      logger.error(`[ESAJ Crawler] Fallback DataJud falhou: ${error.message}`);
      return { processos: [], total: 0 };
    }
  }

  async buscarPorOAB(oab: string, nome?: string): Promise<ESAJBuscaResult> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    const traceId = CrawlerObserver.gerarTraceId();
    const inicio = Date.now();

    let captchaDetectado = false;
    let captchaResolvido = false;
    let usandoFallback = false;

    try {
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
      );

      logger.info(`ESAJ Crawler [${this.tribunalCodigo}][${traceId}]: buscando OAB ${oab}${nome ? ` + nome "${nome}"` : ''}`);

      const config = getCrawlerConfig(this.tribunalCodigo);
      const buscaPath = config?.paths?.buscaOAB || '/cpopg/show.do';

      await page.goto(`${this.baseUrl}${buscaPath}`, {
        waitUntil: 'networkidle2',
        timeout: this.timeout,
      });

      // Verificar e resolver CAPTCHA se presente
      const captchaHandler = new CaptchaHandler(page, this.tribunalCodigo);
      const captchaInfo = await captchaHandler.detectar();

      if (captchaInfo.tipo !== 'none') {
        captchaDetectado = true;
        const resultadoCaptcha = await captchaHandler.detectarEResolver();
        captchaResolvido = resultadoCaptcha.resolvido;

        if (!captchaResolvido) {
          logger.warn(`ESAJ Crawler [${this.tribunalCodigo}][${traceId}]: CAPTCHA detectado mas não resolvido`);
          usandoFallback = true;
          const resultado = this.fallbackDataJud(oab, nome);
          CrawlerObserver.registrarRequisicao(this.tribunalCodigo, Date.now() - inicio, false, {
            tipoErro: 'CAPTCHA_NAO_RESOLVIDO',
            usandoFallback: true,
            captchaDetectado: true,
            captchaResolvido: false,
          });
          return resultado;
        }
      }

      // Clicar na opção "OAB"
      const oabLink = await page.$('a[data-value="OAB"]');
      if (oabLink) {
        await oabLink.click();
        await new Promise(r => setTimeout(r, 1000));
      }

      // Preencher campo OAB - tentar vários seletores
      const filled = await page.evaluate((oabStr: string) => {
        const doc = document as any;
        const selectors = [
          'input[name=" OAB"]',
          'input#nuOABAdvogado',
          'input[name*="nuOAB"]',
          'input[name*="OAB"]',
          'input[id*="nuOAB"]',
          'input[id*="OAB"]',
          'input[placeholder*="OAB"]',
        ];
        for (const sel of selectors) {
          const input = doc.querySelector(sel);
          if (input) {
            input.value = '';
            input.type = 'text';
            input.value = oabStr.replace(/\s/g, '').toUpperCase();
            return true;
          }
        }
        return false;
      }, oab);

      if (!filled) {
        logger.warn(`ESAJ Crawler [${this.tribunalCodigo}][${traceId}]: não encontrou campo OAB`);
        usandoFallback = true;
        const resultado = this.fallbackDataJud(oab, nome);
        CrawlerObserver.registrarRequisicao(this.tribunalCodigo, Date.now() - inicio, false, {
          tipoErro: 'CAMPO_OAB_NAO_ENCONTRADO',
          usandoFallback: true,
          captchaDetectado,
          captchaResolvido,
        });
        return resultado;
      }

      // Preencher campo de nome se fornecido
      if (nome) {
        await page.evaluate((nomeStr: string) => {
          const doc = document as any;
          const nameSelectors = [
            'input[name*="nome"]',
            'input[id*="nome"]',
            'input[placeholder*="nome"]',
            'input[name*="advogado"]',
            'input[id*="advogado"]',
          ];
          for (const sel of nameSelectors) {
            const input = doc.querySelector(sel);
            if (input && !input.value) {
              input.value = nomeStr;
              break;
            }
          }
        }, nome);
      }

      // Clicar Pesquisar
      await page.evaluate(() => {
        const doc = document as any;
        const btns = Array.from(doc.querySelectorAll('button, input[type="submit"], a.btn'));
        const pBtn = btns.find((b: any) =>
          b.textContent?.includes('Pesquisar') ||
          b.value?.includes('Pesquisar')
        );
        if (pBtn) (pBtn as any).click();
      });

      await new Promise(r => setTimeout(r, 3000));
      await page.waitForSelector('table, .resultado, #listagemDeProcessos', { timeout: 10000 }).catch(() => null);

      const resultados = await this.extrairResultadosTabela(page);
      logger.info(`ESAJ Crawler [${this.tribunalCodigo}][${traceId}]: OAB ${oab} retornou ${resultados.length} processos`);

      CrawlerObserver.registrarRequisicao(this.tribunalCodigo, Date.now() - inicio, true, {
        usandoFallback,
        captchaDetectado,
        captchaResolvido,
      });

      return { processos: resultados, total: resultados.length };
    } catch (error: any) {
      logger.error(`ESAJ Crawler [${this.tribunalCodigo}][${traceId}]: erro ao buscar OAB ${oab}: ${error.message}`);

      CrawlerObserver.registrarRequisicao(this.tribunalCodigo, Date.now() - inicio, false, {
        tipoErro: error.message,
        usandoFallback: true,
        captchaDetectado,
        captchaResolvido,
      });

      return this.fallbackDataJud(oab, nome);
    } finally {
      await page.close();
    }
  }

  async buscarDetalhesProcesso(numeroProcesso: string): Promise<ESAJDadosCompletos | null> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
      );

      const numFormatado = numeroProcesso.replace(/\D/g, '');
      const config = getCrawlerConfig(this.tribunalCodigo);
      const detalheBase = config?.paths?.detalheProcesso || '/cpopg/show.do?processo.numero=';

      const urlsParaTentar = [
        `${this.baseUrl}${detalheBase}${numFormatado}`,
        `${this.baseUrl}/cpopg5/show.do?processo=${numFormatado}`,
        `${this.baseUrl}/cpopg/search.do?processo=${numFormatado}`,
      ];

      let loaded = false;
      for (const url of urlsParaTentar) {
        try {
          await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
          loaded = true;
          break;
        } catch { /* tenta próxima */ }
      }

      if (!loaded) return null;

      await new Promise(r => setTimeout(r, 2000));
      const dados = await this.extrairDadosProcesso(page);
      return dados;
    } catch (error: any) {
      logger.error(`ESAJ Crawler [${this.tribunalCodigo}]: erro ao buscar detalhes do processo ${numeroProcesso}: ${error.message}`);
      return null;
    } finally {
      await page.close();
    }
  }

  private async extrairResultadosTabela(page: Page): Promise<ESAJBuscaResult['processos']> {
    return page.evaluate(() => {
      const doc = document as any;
      const resultados: any[] = [];

      const rows = doc.querySelectorAll('table tbody tr, .resultado tr, #listagem tr');
      if (rows.length === 0) {
        const links = doc.querySelectorAll('a[href*="processo"], a[href*="show.do"]');
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
        return resultados;
      }

      rows.forEach((row: any) => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 3) {
          const numeroEl = cells[0].querySelector('a');
          const numero = numeroEl?.textContent?.trim() || '';
          const classe = cells[1]?.textContent?.trim() || '';
          const orgao = cells[2]?.textContent?.trim() || '';
          const data = cells[3]?.textContent?.trim() || '';

          if (numero.match(/\d{7,}/)) {
            resultados.push({
              numeroProcesso: numero.replace(/\D/g, ''),
              classe,
              orgao,
              dataAjuizamento: data,
            });
          }
        }
      });

      return resultados;
    });
  }

  private async extrairDadosProcesso(page: Page): Promise<ESAJDadosCompletos | null> {
    return page.evaluate(() => {
      const doc = document;
      const resultado: ESAJDadosCompletos = { numeroProcesso: '', partes: [] };

      const numeroEl = doc.querySelector(
        '#numeroProcesso, .numeroProcesso, [class*="numeroProcesso"], .processo-numero, span[id="numeroProcesso"]'
      );
      resultado.numeroProcesso = numeroEl?.textContent?.trim().replace(/\D/g, '') || '';

      const classeEl = doc.querySelector('#classeProcesso, .classeProcesso, [class*="classeProcesso"], .labelClass, [id*="classe"]');
      resultado.classe = classeEl?.textContent?.trim() || '';

      const assuntoEl = doc.querySelector('#assuntoProcesso, .assuntoProcesso, [class*="assunto"], [id*="assunto"]');
      resultado.assunto = assuntoEl?.textContent?.trim() || '';

      const orgaoEl = doc.querySelector('#orgaoJulgador, .orgaoJulgador, [class*="orgaoJulgador"], [id*="orgaoJulgador"]');
      resultado.orgao = orgaoEl?.textContent?.trim() || '';

      const valorEl = doc.querySelector('#valorCausa, .valorCausa, [class*="valorCausa"], [id*="valorCausa"]');
      if (valorEl) {
        const valorTexto = valorEl.textContent?.trim() || '';
        const valorNum = parseFloat(valorTexto.replace(/\./g, '').replace(',', '.').replace(/[^\d,]/g, ''));
        if (!isNaN(valorNum)) resultado.valorCausa = valorNum;
      }

      const poloAtivoEls = doc.querySelectorAll('#poloAtivo .parte, #poloAtivo .dado-parte, [id="poloAtivo"] tr, .poloAtivo .container');
      poloAtivoEls.forEach((p: any) => {
        const nomeEl = p.querySelector('[class*="nomeParte"], [class*="nomePessoa"], span, strong');
        const nome = nomeEl?.textContent?.trim() || '';
        if (nome && nome.length > 2) {
          const advogados: string[] = [];
          p.querySelectorAll('[class*="advogado"], [class*="adv"]').forEach((a: any) => {
            const txt = a.textContent?.trim();
            if (txt) advogados.push(txt);
          });
          resultado.partes.push({ nome, tipo: 'AUTOR', advogados });
        }
      });

      const poloPassivoEls = doc.querySelectorAll('#poloPassivo .parte, #poloPassivo .dado-parte, [id="poloPassivo"] tr, .poloPassivo .container');
      poloPassivoEls.forEach((p: any) => {
        const nomeEl = p.querySelector('[class*="nomeParte"], [class*="nomePessoa"], span, strong');
        const nome = nomeEl?.textContent?.trim() || '';
        if (nome && nome.length > 2) {
          const advogados: string[] = [];
          p.querySelectorAll('[class*="advogado"], [class*="adv"]').forEach((a: any) => {
            const txt = a.textContent?.trim();
            if (txt) advogados.push(txt);
          });
          resultado.partes.push({ nome, tipo: 'REU', advogados });
        }
      });

      const movs = doc.querySelectorAll('#tabelaUltimasMovimentacoes tr, .movimentacao, [id*="movimentacao"] tr, .table td:first-child');
      if (movs.length > 0) {
        resultado.ultimaMovimentacao = movs[0].textContent?.trim() || '';
      }

      return resultado;
    });
  }

  async enriquecimentoCompleto(numeroProcesso: string, dadosDataJud: any): Promise<any> {
    const dadosESAJ = await this.buscarDetalhesProcesso(numeroProcesso);

    if (!dadosESAJ) return dadosDataJud;

    return {
      ...dadosDataJud,
      valorCausa: dadosESAJ.valorCausa ?? dadosDataJud.valorCausa,
      partes: dadosESAJ.partes.length > 0 ? dadosESAJ.partes : dadosDataJud.partes,
      ultimaMovimentacao: dadosESAJ.ultimaMovimentacao ?? dadosDataJud.ultimaMovimentacao,
      orgaoJulgador: dadosESAJ.orgao || dadosDataJud.orgaoJulgador,
      dadosESAJ,
    };
  }
}

// Instância padrão (TJSP) para backward compatibility
const defaultESAJCrawler = new ESAJCrawler({ tribunalCodigo: 'TJSP' });

export { ESAJCrawler };
export default defaultESAJCrawler;
