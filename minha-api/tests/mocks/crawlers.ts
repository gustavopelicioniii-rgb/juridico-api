/**
 * Mocks para testes de crawlers
 *
 * Fornece respostas simuladas para tribunais ESAJ e PJe
 * sem fazer chamadas reais à rede.
 */

import { Page, Browser } from 'puppeteer';

// ============================================================
// Mock Page
// ============================================================

export interface MockPageConfig {
  url?: string;
  content?: string;
  html?: string;
  evaluateResult?: any;
  evaluateError?: Error;
  waitForSelectorResult?: boolean;
  waitForSelectorTimeout?: boolean;
  gotoError?: Error;
  extraSelectors?: Record<string, any>;
}

export function createMockPage(config: MockPageConfig = {}): Page {
  const {
    url = 'https://example.com',
    html = '<html><body><p>Test</p></body></html>',
    evaluateResult = null,
    evaluateError,
    waitForSelectorResult = true,
    waitForSelectorTimeout = false,
    gotoError,
    extraSelectors = {},
  } = config;

  const mockPage = {
    url: () => url,
    goto: jest.fn().mockImplementation(() => {
      if (gotoError) throw gotoError;
      return Promise.resolve();
    }),
    setViewport: jest.fn().mockResolvedValue(undefined),
    setUserAgent: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    waitForSelector: jest.fn().mockImplementation(() => {
      if (waitForSelectorTimeout) {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Timeout')), 100);
        });
      }
      return Promise.resolve(waitForSelectorResult ? {} : null);
    }),
    evaluate: jest.fn().mockImplementation(() => {
      if (evaluateError) throw evaluateError;
      return Promise.resolve(evaluateResult);
    }),
    $: jest.fn().mockImplementation((selector: string) => {
      if (selector in extraSelectors) {
        return Promise.resolve(extraSelectors[selector]);
      }
      if (selector.includes('captcha') || selector.includes('recaptcha')) {
        return Promise.resolve(null);
      }
      return Promise.resolve({ click: jest.fn() });
    }),
    $$: jest.fn().mockResolvedValue([]),
    content: jest.fn().mockResolvedValue(html),
  } as unknown as Page;

  return mockPage;
}

// ============================================================
// Mock Browser
// ============================================================

export function createMockBrowser(pages: Page[] = []): Browser {
  return {
    newPage: jest.fn().mockResolvedValue(pages[0] || createMockPage()),
    close: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockReturnValue(true),
    pages: jest.fn().mockResolvedValue(pages),
    version: jest.fn().mockReturnValue('test-version'),
    process: jest.fn().mockReturnValue({ pid: 12345 }),
  } as unknown as Browser;
}

// ============================================================
// HTML Fixtures para ESAJ
// ============================================================

export const ESAJ_HTML = {
  // Página de busca com resultados
  buscaComResultados: `
    <html>
      <body>
        <table>
          <tbody>
            <tr>
              <td><a href="/cpopg/show.do?processo=0001234-56.2023.8.26.0100">0001234-56.2023.8.26.0100</a></td>
              <td>Procedimento Comum Cível</td>
              <td>Foro Central</td>
              <td>15/03/2023</td>
            </tr>
            <tr>
              <td><a href="/cpopg/show.do?processo=0005678-90.2023.8.26.0050">0005678-90.2023.8.26.0050</a></td>
              <td>Monitória</td>
              <td>Foro Regional</td>
              <td>20/04/2023</td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  `,

  // Página de busca sem resultados
  buscaVazia: `
    <html>
      <body>
        <div class="resultado">Nenhum processo encontrado.</div>
      </body>
    </html>
  `,

  // Página de detalle de processo
  processoDetalhe: `
    <html>
      <body>
        <span id="numeroProcesso">0001234-56.2023.8.26.0100</span>
        <span id="classeProcesso">Procedimento Comum Cível</span>
        <span id="assuntoProcesso">Contratos</span>
        <span id="orgaoJulgador">Foro Central - 1ª Vara Cível</span>
        <span id="valorCausa">R$ 50.000,00</span>
        <div id="poloAtivo">
          <div class="parte">
            <span class="nomePessoa">João da Silva</span>
            <span class="advogado">Dr. Pedro Santos - OAB/SP 123456</span>
          </div>
        </div>
        <div id="poloPassivo">
          <div class="parte">
            <span class="nomePessoa">Empresa ABC Ltda</span>
          </div>
        </div>
        <table id="tabelaUltimasMovimentacoes">
          <tr><td>15/03/2023 - Distribuição</td></tr>
        </table>
      </body>
    </html>
  `,

  // Página com CAPTCHA
  comCaptcha: `
    <html>
      <body>
        <div class="g-recaptcha" data-sitekey="6LdIAAAAA">
          <textarea name="g-recaptcha-response"></textarea>
        </div>
        <p>Por favor, complete o CAPTCHA para continuar.</p>
      </body>
    </html>
  `,

  // Página com campo OAB
  campoOAB: `
    <html>
      <body>
        <a data-value="OAB">Consultar por OAB</a>
        <input id="nuOABAdvogado" name="nuOABAdvogado" type="text" />
        <button>Pesquisar</button>
      </body>
    </html>
  `,
};

// ============================================================
// HTML Fixtures para PJe
// ============================================================

export const PJE_HTML = {
  // Página de busca com resultados
  buscaComResultados: `
    <html>
      <body>
        <table class="resultado">
          <tr>
            <td><a href="/pje/consulta/processo/1234567">0001234-56.2023.8.26.0100</a></td>
            <td>Procedimento Comum</td>
            <td>1ª Vara Cível</td>
            <td>15/03/2023</td>
          </tr>
        </table>
      </body>
    </html>
  `,

  // Página de busca vazia
  buscaVazia: `
    <html>
      <body>
        <div id="resultado">Nenhum resultado encontrado.</div>
      </body>
    </html>
  `,

  // Página de detalle
  processoDetalhe: `
    <html>
      <body>
        <div class="numeroProcesso">0001234-56.2023.8.26.0100</div>
        <div class="classe">Procedimento Comum Cível</div>
        <div class="orgao">1ª Vara Cível</div>
        <div class="valor">R$ 50.000,00</div>
        <div class="poloAtivo">
          <div class="parte"><span>João da Silva</span></div>
        </div>
      </body>
    </html>
  `,
};

// ============================================================
// Mock ESAJ Crawler
// ============================================================

export class MockESAJCrawler {
  private mockPages: Page[] = [];
  private currentPageIndex = 0;

  constructor(pages: Page[] = []) {
    this.mockPages = pages;
  }

  addPage(page: Page): void {
    this.mockPages.push(page);
  }

  setNextPage(page: Page): void {
    this.mockPages.push(page);
  }

  getNextPage(): Page | undefined {
    return this.mockPages[this.currentPageIndex++];
  }

  reset(): void {
    this.currentPageIndex = 0;
  }
}

// ============================================================
// Mock do TribunalAdapter (DataJud)
// ============================================================

export function createMockDataJudAdapter(resultados: any[] = []) {
  return {
    buscarPorOAB: jest.fn().mockResolvedValue({
      processos: resultados.map(r => ({
        numeroProcesso: r.numero || '0000000-00.0000.0.00.0000',
        classe: r.classe || '',
        orgao: r.orgao || '',
        dataAjuizamento: r.data || '',
      })),
      total: resultados.length,
    }),
    buscarProcesso: jest.fn().mockImplementation((numero: string) => {
      const found = resultados.find(r => r.numero === numero);
      return Promise.resolve(found || {
        numeroProcesso: numero,
        classe: 'Procedimento Comum',
        assunto: 'Contratos',
        dataAjuizamento: new Date().toISOString(),
      });
    }),
  };
}

// ============================================================
// Helper para criar mocks rápidos
// ============================================================

export function createQuickMockPage(
  selectors: Record<string, any> = {},
  evaluateResult: any = null
): Page {
  return createMockPage({
    html: '<html><body></body></html>',
    extraSelectors: selectors,
    evaluateResult,
  });
}

export function createPageWithResults(
  processos: Array<{ numero: string; classe: string; orgao: string }>
): Page {
  const rows = processos
    .map(
      p => `
    <tr>
      <td><a href="/processo/${p.numero}">${p.numero}</a></td>
      <td>${p.classe}</td>
      <td>${p.orgao}</td>
      <td>01/01/2023</td>
    </tr>
  `
    )
    .join('');

  return createMockPage({
    html: `<html><body><table><tbody>${rows}</tbody></table></body></html>`,
    evaluateResult: processos.map(p => ({
      numeroProcesso: p.numero.replace(/\D/g, ''),
      classe: p.classe,
      orgao: p.orgao,
      dataAjuizamento: '01/01/2023',
    })),
  });
}

export function createPageWithProcessoDetalhe(dados: {
  numero?: string;
  classe?: string;
  assunto?: string;
  orgao?: string;
  valor?: number;
  partes?: Array<{ nome: string; tipo: string }>;
}): Page {
  return createMockPage({
    html: PJE_HTML.processoDetalhe,
    evaluateResult: {
      numeroProcesso: dados.numero || '0001234-56.2023.8.26.0100',
      classe: dados.classe || 'Procedimento Comum Cível',
      assunto: dados.assunto || 'Contratos',
      orgao: dados.orgao || 'Foro Central',
      valorCausa: dados.valor || 50000,
      partes: dados.partes || [
        { nome: 'João da Silva', tipo: 'AUTOR' },
        { nome: 'Empresa ABC', tipo: 'REU' },
      ],
    },
  });
}
