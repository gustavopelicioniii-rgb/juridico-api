import axios from 'axios';
import * as cheerio from 'cheerio';
import { ResultadoBusca } from '../ITribunalAdapter';
import {
  getTribunalSourceConfig,
  TribunalSourceStrategy,
  TribunalSourceKind,
} from '../../config/tribunalSources';

export type OABSourceStatus =
  | 'success'
  | 'empty'
  | 'requires-auth'
  | 'captcha'
  | 'blocked'
  | 'error'
  | 'unsupported';

export interface OABSourceLog {
  fonte: string;
  status: OABSourceStatus;
  tribunalCodigo: string;
  url?: string;
  mensagem?: string;
  total?: number;
  tempoMs?: number;
}

export interface OABSourceResult {
  processos: ResultadoBusca['processos'];
  logs: OABSourceLog[];
}

export interface OABSearchProvider {
  kind: TribunalSourceKind;
  buscar(strategy: TribunalSourceStrategy, params: {
    tribunalCodigo: string;
    oabNumero: string;
    nome?: string;
  }): Promise<OABSourceResult>;
}

const CNJ_REGEX = /\b\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}\b/g;

function formatarCNJ(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 20) return value;
  return `${digits.slice(0, 7)}-${digits.slice(7, 9)}.${digits.slice(9, 13)}.${digits.slice(13, 14)}.${digits.slice(14, 16)}.${digits.slice(16)}`;
}

function uniqueCNJs(html: string): string[] {
  return Array.from(new Set((html.match(CNJ_REGEX) || []).map(formatarCNJ)));
}

function hasCaptcha(html: string): boolean {
  return /g-recaptcha|captcha|hcaptcha|cf-challenge/i.test(html);
}

function isLoginPage(html: string): boolean {
  return /senha|certificado digital|login|keycloak|entrar/i.test(html) && !/consulta p[úu]blica/i.test(html);
}

function statusForPolicy(policy: TribunalSourceStrategy['policy']): OABSourceStatus {
  if (policy === 'requires-login' || policy === 'requires-certificate') return 'requires-auth';
  if (policy === 'captcha' || policy === 'blocked') return policy;
  return 'unsupported';
}

function absoluteUrl(base: string, action?: string): string {
  if (!action) return base;
  return new URL(action, base).toString();
}

class UnsupportedProvider implements OABSearchProvider {
  constructor(public readonly kind: TribunalSourceKind) {}

  async buscar(strategy: TribunalSourceStrategy, params: { tribunalCodigo: string }): Promise<OABSourceResult> {
    return {
      processos: [],
      logs: [{
        fonte: this.kind,
        status: statusForPolicy(strategy.policy),
        tribunalCodigo: params.tribunalCodigo,
        url: strategy.urls[0],
        mensagem: strategy.description,
        total: 0,
      }],
    };
  }
}

class PJePublicProvider implements OABSearchProvider {
  kind: TribunalSourceKind = 'pje-public';

  async buscar(strategy: TribunalSourceStrategy, params: {
    tribunalCodigo: string;
    oabNumero: string;
    nome?: string;
  }): Promise<OABSourceResult> {
    const logs: OABSourceLog[] = [];
    const processos = new Map<string, ResultadoBusca['processos'][number]>();

    for (const url of strategy.urls) {
      const started = Date.now();
      try {
        const initial = await axios.get<string>(url, {
          timeout: 25_000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept: 'text/html,application/xhtml+xml',
          },
          validateStatus: status => status < 500,
        });

        if (initial.status === 401 || initial.status === 403 || isLoginPage(initial.data)) {
          logs.push({
            fonte: this.kind,
            status: 'requires-auth',
            tribunalCodigo: params.tribunalCodigo,
            url,
            mensagem: 'Consulta pública exige login/certificado neste endpoint.',
            tempoMs: Date.now() - started,
          });
          continue;
        }

        if (hasCaptcha(initial.data)) {
          logs.push({
            fonte: this.kind,
            status: 'captcha',
            tribunalCodigo: params.tribunalCodigo,
            url,
            mensagem: 'Consulta pública contém captcha.',
            tempoMs: Date.now() - started,
          });
          continue;
        }

        const responseHtml = await this.submitPJeSearch(url, initial.data, params.oabNumero, params.nome);
        const cnjs = uniqueCNJs(responseHtml);
        for (const numeroProcesso of cnjs) {
          processos.set(numeroProcesso, {
            numeroProcesso,
            tribunalCodigo: params.tribunalCodigo,
            sistema: 'PJe',
            formato: 'ELETRONICO',
          });
        }

        logs.push({
          fonte: this.kind,
          status: cnjs.length > 0 ? 'success' : 'empty',
          tribunalCodigo: params.tribunalCodigo,
          url,
          mensagem: cnjs.length > 0
            ? `${cnjs.length} CNJ(s) encontrados na consulta pública PJe.`
            : 'Endpoint público acessível, mas não retornou CNJs para a OAB.',
          total: cnjs.length,
          tempoMs: Date.now() - started,
        });
      } catch (error) {
        logs.push({
          fonte: this.kind,
          status: 'error',
          tribunalCodigo: params.tribunalCodigo,
          url,
          mensagem: error instanceof Error ? error.message : String(error),
          total: 0,
          tempoMs: Date.now() - started,
        });
      }
    }

    return { processos: Array.from(processos.values()), logs };
  }

  private async submitPJeSearch(url: string, html: string, oabNumero: string, nome?: string): Promise<string> {
    const $ = cheerio.load(html);
    const form = $('form').first();
    if (form.length === 0) {
      return html;
    }

    const payload = new URLSearchParams();
    form.find('input, select, textarea').each((_, el) => {
      const name = $(el).attr('name');
      if (!name) return;
      payload.set(name, $(el).attr('value') || '');
    });

    const oabField = form.find('input[name*="OAB" i], input[id*="OAB" i], input[name*="oab" i], input[id*="oab" i]').first();
    const nomeField = form.find('input[name*="advogado" i], input[id*="advogado" i], input[name*="nome" i], input[id*="nome" i]').first();

    if (oabField.attr('name')) {
      payload.set(oabField.attr('name')!, oabNumero);
    } else {
      payload.set('oab', oabNumero);
      payload.set('numeroOAB', oabNumero);
    }

    if (nome && nomeField.attr('name')) {
      payload.set(nomeField.attr('name')!, nome);
    }

    const submit = form.find('input[type="submit"], button[type="submit"]').first();
    const submitName = submit.attr('name');
    if (submitName) {
      payload.set(submitName, submit.attr('value') || submit.text() || 'Pesquisar');
    }

    const action = absoluteUrl(url, form.attr('action'));
    const response = await axios.post<string>(action, payload.toString(), {
      timeout: 30_000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: url,
      },
      validateStatus: status => status < 500,
    });

    return response.data;
  }
}

const PROVIDERS: Record<string, OABSearchProvider> = {
  'pje-public': new PJePublicProvider(),
  eproc: new UnsupportedProvider('eproc'),
  projudi: new UnsupportedProvider('projudi'),
  mni: new UnsupportedProvider('mni'),
  'court-specific': new UnsupportedProvider('court-specific'),
};

export async function buscarPorFontesOficiais(params: {
  tribunalCodigo: string;
  oabNumero: string;
  nome?: string;
  ignorarTipos?: TribunalSourceKind[];
}): Promise<OABSourceResult> {
  const config = getTribunalSourceConfig(params.tribunalCodigo);
  if (!config) return { processos: [], logs: [] };

  const logs: OABSourceLog[] = [];
  const processos = new Map<string, ResultadoBusca['processos'][number]>();
  const ignored = new Set(params.ignorarTipos || []);

  for (const strategy of config.strategies) {
    if (strategy.kind === 'datajud' || strategy.kind === 'esaj' || ignored.has(strategy.kind)) continue;

    const provider = PROVIDERS[strategy.kind] || new UnsupportedProvider(strategy.kind);
    const result = await provider.buscar(strategy, params);
    for (const log of result.logs) logs.push(log);
    for (const processo of result.processos) processos.set(processo.numeroProcesso, processo);

    if (processos.size > 0) break;
  }

  return { processos: Array.from(processos.values()), logs };
}
