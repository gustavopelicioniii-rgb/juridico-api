/**
 * CaptchaHandler - Módulo centralizado de detecção e tratamento de CAPTCHA
 *
 * Suporta múltiplas estratégias:
 * 1. 2Captcha API (recomendado para produção)
 * 2. Fallback via DataJud quando disponível
 * 3. Skip (para tribunais que não exigem CAPTCHA)
 *
 * Uso:
 *   const handler = new CaptchaHandler(page, tribunalCodigo);
 *   const resolved = await handler.detectarEResolver();
 */

import type { Page } from 'puppeteer';
import logger from '../config/logger';

export interface CaptchaConfig {
  provider: '2captcha' | 'none' | 'datajud_fallback';
  apiKey?: string;
  timeoutMs?: number;
  retryAttempts?: number;
}

export interface CaptchaResultado {
  resolvido: boolean;
  Provider: '2captcha' | 'none' | 'datajud_fallback' | 'skipped';
  gRecaptchaResponse?: string;
  erro?: string;
}

interface CaptchaInfo {
  tipo: 'recaptcha_v2' | 'recaptcha_v3' | 'hcaptcha' | 'simple' | 'none';
  siteKey?: string;
  url: string;
}

const CAPTCHA_SELECTORES = {
  recaptcha: [
    '.g-recaptcha',
    '[data-sitekey]',
    '#captcha',
    'iframe[src*="recaptcha"]',
    '.recaptcha-checkbox',
  ],
  hcaptcha: [
    '.h-captcha',
    '[data-hcaptcha-sitekey]',
    'iframe[src*="hcaptcha"]',
  ],
  simple: [
    'img[captcha]',
    'input[type="captcha"]',
    '#imgCaptcha',
    '.captcha-image',
    'input[name="codigo"]',
  ],
};

const RECAPTCHA_V2_SITEKEY_PATTERN = /data-sitekey=["']([^"']+)["']/;
const HCAPTCHA_SITEKEY_PATTERN = /data-hcaptcha-sitekey=["']([^"']+)["']/;

export class CaptchaHandler {
  private page: Page;
  private tribunalCodigo: string;
  private config: CaptchaConfig;

  constructor(page: Page, tribunalCodigo: string, config?: Partial<CaptchaConfig>) {
    this.page = page;
    this.tribunalCodigo = tribunalCodigo;
    this.config = {
      provider: config?.provider || this.detectarProviderPadrao(),
      apiKey: config?.apiKey || process.env.TWOCAPTCHA_API_KEY,
      timeoutMs: config?.timeoutMs || 120000,
      retryAttempts: config?.retryAttempts || 3,
    };
  }

  private detectarProviderPadrao(): CaptchaConfig['provider'] {
    if (process.env.TWOCAPTCHA_API_KEY) {
      return '2captcha';
    }
    return 'datajud_fallback';
  }

  /**
   * Detecta se a página atual contém CAPTCHA e identifica o tipo
   */
  async detectar(): Promise<CaptchaInfo> {
    const url = this.page.url();

    try {
      const bodyText = await this.page.evaluate(() => document.body?.innerText?.toLowerCase() || '');

      // Verifica se há texto indicando CAPTCHA
      const temCaptchaTexto = bodyText.includes('captcha') ||
        bodyText.includes('não sou um robô') ||
        bodyText.includes('não sou um robo') ||
        bodyText.includes('i am not a robot') ||
        bodyText.includes('prove que');

      // Procura elementos de CAPTCHA
      const elementosCaptcha = await this.page.evaluate(() => {
        const seletores = [
          ...CAPTCHA_SELECTORES.recaptcha,
          ...CAPTCHA_SELECTORES.hcaptcha,
          ...CAPTCHA_SELECTORES.simple,
        ];

        for (const seletor of seletores) {
          const el = document.querySelector(seletor);
          if (el) {
            return {
              seletor,
              html: el.innerHTML.substring(0, 200),
              outerHTML: el.outerHTML.substring(0, 300),
            };
          }
        }
        return null;
      });

      // Detecta reCAPTCHA v2
      if (elementosCaptcha) {
        const html = elementosCaptcha.html || elementosCaptcha.outerHTML || '';

        if (html.includes('data-sitekey') || seletorContem(elementosCaptcha.seletor, 'recaptcha')) {
          const match = html.match(RECAPTCHA_V2_SITEKEY_PATTERN) || html.match(/sitekey=([^&"']+)/);
          const siteKey = match ? match[1] : undefined;

          return {
            tipo: 'recaptcha_v2',
            siteKey,
            url,
          };
        }

        if (html.includes('hcaptcha') || seletorContem(elementosCaptcha.seletor, 'hcaptcha')) {
          const match = html.match(HCAPTCHA_SITEKEY_PATTERN);
          const siteKey = match ? match[1] : undefined;

          return {
            tipo: 'hcaptcha',
            siteKey,
            url,
          };
        }

        return {
          tipo: 'simple',
          url,
        };
      }

      if (temCaptchaTexto) {
        return {
          tipo: 'simple',
          url,
        };
      }

      return {
        tipo: 'none',
        url,
      };
    } catch (error: any) {
      logger.warn(`[CaptchaHandler] Erro ao detectar CAPTCHA: ${error.message}`);
      return {
        tipo: 'none',
        url,
      };
    }
  }

  /**
   * Detecta e tenta resolver o CAPTCHA usando a estratégia configurada
   */
  async detectarEResolver(): Promise<CaptchaResultado> {
    const info = await this.detectar();

    if (info.tipo === 'none') {
      return {
        resolvido: true,
        provider: 'none',
      };
    }

    logger.info(`[CaptchaHandler] CAPTCHA detectado: ${info.tipo} em ${this.tribunalCodigo}`);

    switch (this.config.provider) {
      case '2captcha':
        return this.resolver2Captcha(info);
      case 'datajud_fallback':
        return this.fallbackDataJud(info);
      case 'none':
      default:
        return {
          resolvido: false,
          provider: 'skipped',
          erro: 'CAPTCHA detectado mas provider não configurado',
        };
    }
  }

  /**
   * Resolve CAPTCHA usando 2Captcha API
   */
  private async resolver2Captcha(info: CaptchaInfo): Promise<CaptchaResultado> {
    if (!this.config.apiKey) {
      return {
        resolvido: false,
        provider: '2captcha',
        erro: 'TWOCAPTCHA_API_KEY não configurado',
      };
    }

    if (info.tipo !== 'recaptcha_v2' && info.tipo !== 'hcaptcha') {
      return {
        resolvido: false,
        provider: '2captcha',
        erro: `Tipo de CAPTCHA ${info.tipo} não suportado pelo 2Captcha`,
      };
    }

    const siteKey = info.siteKey;
    if (!siteKey) {
      return {
        resolvido: false,
        provider: '2captcha',
        erro: 'Sitekey não encontrado',
      };
    }

    logger.info(`[CaptchaHandler] Resolvendo ${info.tipo} com 2Captcha (sitekey: ${siteKey.substring(0, 10)}...)`);

    for (let attempt = 1; attempt <= (this.config.retryAttempts || 3); attempt++) {
      try {
        const gRecaptchaResponse = await this.chamar2Captcha(siteKey, info.url);

        if (gRecaptchaResponse) {
          // Insere a resposta no formulário
          await this.page.evaluate((response) => {
            const textarea = document.querySelector('textarea[name="g-recaptcha-response"]') as HTMLTextAreaElement;
            const hiddenInput = document.querySelector('input[name="g-recaptcha-response"]') as HTMLInputElement;

            if (textarea) {
              textarea.value = response;
            }
            if (hiddenInput) {
              hiddenInput.value = response;
            }

            // Dispara eventos de change
            const event = new Event('change', { bubbles: true });
            if (textarea) textarea.dispatchEvent(event);
            if (hiddenInput) hiddenInput.dispatchEvent(event);
          }, gRecaptchaResponse);

          logger.info(`[CaptchaHandler] CAPTCHA resolvido com sucesso (tentativa ${attempt})`);

          return {
            resolvido: true,
            provider: '2captcha',
            gRecaptchaResponse,
          };
        }
      } catch (error: any) {
        logger.warn(`[CaptchaHandler] Tentativa ${attempt} falhou: ${error.message}`);
      }

      // Espera antes de tentar novamente
      if (attempt < (this.config.retryAttempts || 3)) {
        await new Promise(r => setTimeout(r, 5000 * attempt));
      }
    }

    return {
      resolvido: false,
      provider: '2captcha',
      erro: `Falha após ${this.config.retryAttempts} tentativas`,
    };
  }

  /**
   * Chama a API 2Captcha para resolver reCAPTCHA v2
   */
  private async chamar2Captcha(siteKey: string, pageUrl: string): Promise<string | null> {
    const apiKey = this.config.apiKey;

    // Submit do CAPTCHA
    const submitUrl = `https://2captcha.com/in.php?key=${apiKey}&method=userrecaptcha&googlekey=${siteKey}&pageurl=${encodeURIComponent(pageUrl)}`;

    let captchaId: string | null = null;

    try {
      const submitResponse = await fetch(submitUrl, {
        method: 'GET',
      });

      const submitText = await submitResponse.text();

      if (submitText.startsWith('ERROR')) {
        throw new Error(`2Captcha submit error: ${submitText}`);
      }

      const parts = submitText.split('|');
      if (parts.length < 2 || parts[0] !== 'OK') {
        throw new Error(`2Captcha invalid response: ${submitText}`);
      }

      captchaId = parts[1];
    } catch (error: any) {
      // Tenta método alternativo com POST
      try {
        const formData = new URLSearchParams({
          key: apiKey,
          method: 'userrecaptcha',
          googlekey: siteKey,
          pageurl: pageUrl,
        });

        const response = await fetch('https://2captcha.com/in.php', {
          method: 'POST',
          body: formData,
        });

        const text = await response.text();
        if (text.startsWith('OK|')) {
          captchaId = text.split('|')[1];
        } else {
          throw new Error(`2Captcha POST error: ${text}`);
        }
      } catch (retryError: any) {
        throw new Error(`Falha ao enviar CAPTCHA: ${retryError.message}`);
      }
    }

    if (!captchaId) {
      throw new Error('Não foi possível obter CAPTCHA ID');
    }

    // Poll pelo resultado
    const timeoutAt = Date.now() + (this.config.timeoutMs || 120000);
    const pollInterval = 5000;

    while (Date.now() < timeoutAt) {
      await new Promise(r => setTimeout(r, pollInterval));

      try {
        const resultUrl = `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${captchaId}`;
        const resultResponse = await fetch(resultUrl, { method: 'GET' });
        const resultText = await resultResponse.text();

        if (resultText === 'CAPCHA_NOT_READY') {
          continue;
        }

        if (resultText.startsWith('ERROR')) {
          throw new Error(`2Captcha result error: ${resultText}`);
        }

        if (resultText.startsWith('OK|')) {
          return resultText.split('|')[1];
        }
      } catch (error: any) {
        logger.warn(`[CaptchaHandler] Erro ao verificar resultado: ${error.message}`);
      }
    }

    throw new Error('Timeout ao resolver CAPTCHA');
  }

  /**
   * Fallback: marca como não resolvido para usar DataJud
   */
  private fallbackDataJud(_info: CaptchaInfo): CaptchaResultado {
    logger.info(`[CaptchaHandler] Fallback para DataJud - CAPTCHA não resolvido`);
    return {
      resolvido: false,
      provider: 'datajud_fallback',
      erro: 'Fallback para DataJud - CAPTCHA ignorado',
    };
  }

  /**
   * Verifica se a resposta do CAPTCHA foi inserida corretamente
   */
  async verificarResolucao(): Promise<boolean> {
    try {
      const responseValue = await this.page.evaluate(() => {
        const textarea = document.querySelector('textarea[name="g-recaptcha-response"]') as HTMLTextAreaElement;
        const hiddenInput = document.querySelector('input[name="g-recaptcha-response"]') as HTMLInputElement;
        return textarea?.value || hiddenInput?.value || '';
      });

      return responseValue.length > 50;
    } catch {
      return false;
    }
  }
}

/**
 * Helper: detecta se um seletor contém texto específico
 */
function seletorContem(seletor: string, texto: string): boolean {
  return seletor.toLowerCase().includes(texto.toLowerCase());
}

/**
 * Configuração de CAPTCHA por tribunal
 * Determina se um tribunal tipicamente exige CAPTCHA
 */
export const TRIBUNAIS_COM_CAPTCHA: Record<string, boolean> = {
  // TJs - a maioria não exige CAPTCHA via crawler
  TJSP: false,
  TJRJ: false,
  TJMG: true, // TJMG às vezes exige
  TJRS: false,
  TJPR: false,
  TJBA: false,
  TJSC: false,
  TJGO: false,
  TJDFT: false,
  TJPE: false,
  TJCE: false,
  TJES: false,
  TJMS: false,
  TJMT: false,
  TJPB: false,
  TJRN: false,
  TJAL: false,
  TJSE: false,
  TJPI: false,
  TJMA: false,
  TJPA: false,
  TJAM: false,
  TJAP: false,
  TJRO: false,
  TJRR: false,
  TJAC: false,
  TJTO: false,

  // TRTs - PJe geralmente não exige
  TRT1: false,
  TRT2: false,
  TRT3: false,
  TRT4: false,
  TRT5: false,
  TRT6: false,
  TRT7: false,
  TRT8: false,
  TRT9: false,
  TRT10: false,
  TRT11: false,
  TRT12: false,
  TRT13: false,
  TRT14: false,
  TRT15: false,
  TRT16: false,
  TRT17: false,
  TRT18: false,
  TRT19: false,
  TRT20: false,
  TRT21: false,
  TRT22: false,
  TRT23: false,
  TRT24: false,

  // TRFs
  TRF1: false,
  TRF2: false,
  TRF3: false,
  TRF4: false,
  TRF5: false,
  TRF6: false,

  // Superiores
  STJ: true,
  STF: true,
  TST: false,
  TSE: false,
  STM: false,
};

/**
 * Verifica se um tribunal tipicamente exige tratamento de CAPTCHA
 */
export function tribunalExigeCaptcha(tribunalCodigo: string): boolean {
  return TRIBUNAIS_COM_CAPTCHA[tribunalCodigo.toUpperCase()] ?? false;
}

export default CaptchaHandler;
