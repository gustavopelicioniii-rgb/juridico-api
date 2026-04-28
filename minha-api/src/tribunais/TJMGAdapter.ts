/**
 * Adaptador para o Tribunal de Justiça de Minas Gerais (TJ-MG)
 * 
 * Este tribunal possui medidas anti-scraping:
 * - CAPTCHAs para evitar scraping automatizado
 * - Rate limiting agressivo
 * - Detecção de headless browsers
 * 
 * Estratégia: Puppeteer com stealth plugin + 2Captcha para resolver CAPTCHA
 */

import puppeteer from 'puppeteer';
import type { Page, Browser } from 'puppeteer';
import { BaseTribunalAdapter, DadosProcesso, DadosParte, DadosMovimentacao, ResultadoBusca } from './ITribunalAdapter';
import logger from '../config/logger';

interface TJMGParte {
  nome: string;
  tipo: string;
  documento?: string;
}

interface TJMGMovimentacao {
  data: string;
  descricao: string;
}

interface TJMGProcesso {
  numero: string;
  classe?: string;
  assunto?: string;
  distribuicao?: string;
  partes?: TJMGParte[];
  movs?: TJMGMovimentacao[];
}

export class TJMGAdapter extends BaseTribunalAdapter {
  codigo = 'TJMG';
  usaCaptcha = true;
  
  private browser: Browser | null = null;
  private page: Page | null = null;
  private apiKey2Captcha?: string;
  private maxRetries: number = 3;
  
  constructor(apiKey2Captcha?: string) {
    const baseUrl = 'https://www.tjmg.jus.br';
    super(baseUrl, undefined);
    this.apiKey2Captcha = apiKey2Captcha || process.env.TWOCAPTCHA_API_KEY;
  }
  
  /**
   * Inicializa o browser com configurações anti-detecção
   */
  private async initBrowser(): Promise<Browser> {
    if (this.browser) {
      return this.browser;
    }
    
    this.browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
      ],
    });
    
    // Cria página
    this.page = await this.browser.newPage();
    
    // Stealth: remove webdriver property
    await this.page.evaluateOnNewDocument(() => {
      const nav = (globalThis as any).navigator;
      if (nav) {
        Object.defineProperty(nav, 'webdriver', {
          get: () => false,
        });
      }
    });
    
    // Stealth: mock plugins
    await this.page.evaluateOnNewDocument(() => {
      const nav = (globalThis as any).navigator;
      const win = (globalThis as any).window;
      if (win) {
        win.chrome = { runtime: {} };
      }
      if (nav) {
        Object.defineProperty(nav, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });
      }
    });
    
    // Stealth: mock languages
    await this.page.evaluateOnNewDocument(() => {
      const nav = (globalThis as any).navigator;
      if (nav) {
        Object.defineProperty(nav, 'languages', {
          get: () => ['pt-BR', 'pt', 'en-US', 'en'],
        });
      }
    });
    
    logger.info('Browser Puppeteer inicializado para TJ-MG');
    
    return this.browser;
  }
  
  /**
   * Fecha o browser
   */
  private async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
  
  /**
   * Resolve CAPTCHA usando 2Captcha
   */
  private async solveCaptcha(siteKey: string, pageUrl: string): Promise<string> {
    if (!this.apiKey2Captcha) {
      throw new Error('2Captcha API key não configurada');
    }
    
    logger.info('Tentando resolver CAPTCHA...');
    
    // calling 2captcha API
    const formData = new FormData();
    formData.append('key', this.apiKey2Captcha);
    formData.append('method', 'userrecaptcha');
    formData.append('googlekey', siteKey);
    formData.append('pageurl', pageUrl);
    
    // Submit CAPTCHA
    const submitResponse = await fetch('http://2captcha.com/in.php', {
      method: 'POST',
      body: formData,
    });
    
    const submitText = await submitResponse.text();
    const captchaId = submitText.split('|')[1];
    
    if (!captchaId) {
      throw new Error(`Falha ao submeter CAPTCHA: ${submitText}`);
    }
    
    // Poll pelo resultado
    for (let i = 0; i < 60; i++) { // max 60 tries (~60 seconds)
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const resultResponse = await fetch(
        `http://2captcha.com/res.php?key=${this.apiKey2Captcha}&action=get&id=${captchaId}`
      );
      const resultText = await resultResponse.text();
      
      if (resultText === 'CAPCHA_NOT_READY') {
        continue;
      }
      
      if (resultText.startsWith('OK|')) {
        const gRecaptchaResponse = resultText.split('|')[1];
        logger.info('CAPTCHA resolvido com sucesso');
        return gRecaptchaResponse;
      }
      
      throw new Error(`Erro ao resolver CAPTCHA: ${resultText}`);
    }
    
    throw new Error('Timeout ao resolver CAPTCHA');
  }
  
  /**
   * Delay inteligente para evitar detecção
   */
  private async smartDelay(minMs: number = 3000, maxMs: number = 8000): Promise<void> {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  /**
   * Executa busca de processo
   */
  async buscarProcesso(numeroProcesso: string): Promise<DadosProcesso> {
    const numeroFormatado = this.formatarNumeroProcesso(numeroProcesso);
    
    if (!this.validarNumeroProcesso(numeroFormatado)) {
      throw new Error(`Número de processo inválido: ${numeroProcesso}`);
    }
    
    let tentativas = 0;
    
    while (tentativas < this.maxRetries) {
      try {
        return await this.executarBusca(numeroFormatado);
      } catch (error: any) {
        tentativas++;
        logger.warn(`Tentativa ${tentativas} falhou: ${error.message}`);
        
        if (tentativas >= this.maxRetries) {
          throw new Error(`Falha ao buscar processo após ${this.maxRetries} tentativas: ${error.message}`);
        }
        
        // Espera antes de tentar novamente
        await this.smartDelay(5000, 10000);
        await this.closeBrowser(); // Reinicia browser para limpar estado
      }
    }
    
    throw new Error('Erro inesperado na busca');
  }
  
  /**
   * Executa a busca real
   */
  private async executarBusca(numero: string): Promise<DadosProcesso> {
    await this.initBrowser();
    const page = this.page!;
    
    const searchUrl = `${this.baseUrl}/consulta-processo`;
    logger.info(`Navegando para: ${searchUrl}`);
    
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Verifica se há CAPTCHA
    const captchaElement = await page.$('[data-sitekey], .g-recaptcha, #captcha');
    
    if (captchaElement) {
      logger.info('CAPTCHA detectado, tentando resolver...');
      
      const siteKey = await page.$eval('[data-sitekey]', el => el.getAttribute('data-sitekey'))
        || await page.$eval('.g-recaptcha', el => el.getAttribute('data-sitekey'))
        || '';
      
      const gRecaptchaResponse = await this.solveCaptcha(siteKey, searchUrl);
      
      // Insere a resposta do CAPTCHA
      await page.evaluate((response: string) => {
        const doc = (globalThis as any).document;
        const textarea = doc?.querySelector('[name="g-recaptcha-response"]');
        if (textarea) textarea.value = response;
        
        // Também pode haver um campo hidden
        const hiddenInput = doc?.querySelector('input[name="g-recaptcha-response"]');
        if (hiddenInput) hiddenInput.value = response;
      }, gRecaptchaResponse);
    }
    
    // Preenche campo de busca
    const inputSelector = 'input[name="numeroProcesso"], #numeroProcesso, input[id="numero"]';
    await page.waitForSelector(inputSelector, { timeout: 10000 });
    await page.type(inputSelector, numero, { delay: 100 });
    
    await this.smartDelay();
    
    // Clica no botão de busca
    const buttonSelector = 'button[type="submit"], input[type="submit"], .btn-buscar';
    await page.click(buttonSelector);
    
    // Aguarda carregamento dos resultados
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {
      // Às vezes não faz redirect, então apenas aguarda
    });
    
    await this.smartDelay(2000, 4000);
    
    // Parseia a página de resultado
    const html = await page.content();
    return this.parseHtml(html);
  }
  
  /**
   * Parseia HTML da página do TJ-MG
   */
  private parseHtml(html: string): DadosProcesso {
    // Implementação básica de parsing HTML
    // Em produção, usaria cheerio ou DOM parser mais robusto
    
    const numeroMatch = html.match(/Número do Processo:\s*([0-9\.\-]+)/);
    const classeMatch = html.match(/Classe:\s*([^<]+)/);
    const assuntoMatch = html.match(/Assunto:\s*([^<]+)/);
    
    const numeroProcesso = numeroMatch?.[1]?.replace(/\./g, '') || 'DESCONHECIDO';
    const classe = classeMatch?.[1]?.trim();
    const assunto = assuntoMatch?.[1]?.trim();
    
    // Extrai partes (exemplo genérico - ajuste conforme HTML real)
    const partes: DadosParte[] = [];
    const parteAutorMatch = html.match(/Autores?:\s*([^<]+)/gi);
    if (parteAutorMatch) {
      parteAutorMatch.forEach(match => {
        const nome = match.replace(/Autores?:\s*/i, '').trim();
        partes.push({ nome, tipo: 'AUTOR', isAdvogado: false });
      });
    }
    
    const parteReuMatch = html.match(/Réus?:\s*([^<]+)/gi);
    if (parteReuMatch) {
      parteReuMatch.forEach(match => {
        const nome = match.replace(/Réus?:\s*/i, '').trim();
        partes.push({ nome, tipo: 'REU', isAdvogado: false });
      });
    }
    
    // Extrai movimentações
    const movs: DadosMovimentacao[] = [];
    const dataMovMatch = html.matchAll(/(\d{2}\/\d{2}\/\d{4})\s*-\s*([^<]+)/g);
    for (const match of dataMovMatch) {
      movs.push({
        data: new Date(match[1].split('/').reverse().join('-')),
        descricao: match[2].trim(),
        origem: 'TJMG',
        dadosOriginais: {},
      });
    }
    
    return {
      numeroProcesso,
      tribunalCodigo: this.codigo,
      classe,
      assunto,
      partes,
      movimentacoes: movs,
      dadosOriginais: { html: html.substring(0, 10000) }, // Salva parte do HTML para debug
    };
  }
  
  /**
   * Busca por OAB (não suportado pelo TJ-MG de forma direta)
   */
  async buscarPorOAB(oab: string, nome?: string): Promise<ResultadoBusca> {
    // TJ-MG não tem endpoint público para busca por OAB
    // O usuário precisa saber o número do processo
    logger.warn('TJ-MG não suporta busca por OAB diretamente');
    
    return {
      processos: [],
      total: 0,
    };
  }
  
  /**
   * Verifica status do adapter
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.initBrowser();
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Cleanup
   */
  async cleanup(): Promise<void> {
    await this.closeBrowser();
  }
}

export default TJMGAdapter;
