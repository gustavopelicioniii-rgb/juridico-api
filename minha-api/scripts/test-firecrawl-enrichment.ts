import axios from 'axios';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

interface ScrapeSummary {
  ok: boolean;
  provider: 'direct' | 'firecrawl';
  elapsedMs: number;
  statusCode?: number;
  title?: string;
  textChars: number;
  linksCount: number;
  sample: string;
  containsMatches?: Record<string, boolean>;
  metadata?: Record<string, unknown>;
  error?: string;
}

interface FirecrawlResponse {
  success?: boolean;
  data?: {
    markdown?: string;
    html?: string;
    links?: string[];
    metadata?: Record<string, unknown>;
  };
  error?: string;
}

interface CliOptions {
  url: string;
  contains: string[];
  output?: string;
  timeoutMs: number;
  onlyMainContent: boolean;
}

const DEFAULT_FIRECRAWL_BASE_URL = 'https://api.firecrawl.dev';

function getArg(name: string): string | undefined {
  const inlinePrefix = `--${name}=`;
  const inline = process.argv.find(arg => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1];

  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseContains(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function parseOptions(): CliOptions {
  const url = getArg('url') || process.env.FIRECRAWL_TEST_URL;
  if (!url) {
    throw new Error(
      'Informe uma URL com --url=<url> ou defina FIRECRAWL_TEST_URL no .env'
    );
  }

  return {
    url,
    contains: parseContains(getArg('contains') || process.env.FIRECRAWL_TEST_CONTAINS),
    output: getArg('output') || process.env.FIRECRAWL_TEST_OUTPUT,
    timeoutMs: Number(getArg('timeoutMs') || process.env.FIRECRAWL_TIMEOUT_MS || 30000),
    onlyMainContent: !hasFlag('include-all-content'),
  };
}

function normalizeText(value?: string): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function sampleText(value?: string, maxLength = 900): string {
  const normalized = normalizeText(value);
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

function countNeedles(text: string, needles: string[]): Record<string, boolean> {
  const normalized = text.toLowerCase();
  return needles.reduce<Record<string, boolean>>((acc, needle) => {
    acc[needle] = normalized.includes(needle.toLowerCase());
    return acc;
  }, {});
}

async function scrapeDirect(
  url: string,
  timeoutMs: number,
  contains: string[]
): Promise<ScrapeSummary> {
  const startedAt = Date.now();

  try {
    const response = await axios.get<string>(url, {
      timeout: timeoutMs,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'juridico-api-firecrawl-comparison/1.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    const $ = cheerio.load(response.data);
    $('script, style, noscript, svg').remove();

    const title = normalizeText($('title').first().text());
    const bodyText = normalizeText($('body').text());
    const links = new Set<string>();

    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      if (!href) return;

      try {
        links.add(new URL(href, url).toString());
      } catch {
        links.add(href);
      }
    });

    return {
      ok: true,
      provider: 'direct',
      elapsedMs: Date.now() - startedAt,
      statusCode: response.status,
      title,
      textChars: bodyText.length,
      linksCount: links.size,
      sample: sampleText(bodyText),
      containsMatches: countNeedles(bodyText, contains),
      metadata: {
        contentType: response.headers['content-type'],
        finalUrl: response.request?.res?.responseUrl || url,
      },
    };
  } catch (error: any) {
    return {
      ok: false,
      provider: 'direct',
      elapsedMs: Date.now() - startedAt,
      textChars: 0,
      linksCount: 0,
      sample: '',
      error: error.message,
      statusCode: error.response?.status,
    };
  }
}

async function scrapeFirecrawl(options: CliOptions): Promise<ScrapeSummary> {
  const startedAt = Date.now();
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      provider: 'firecrawl',
      elapsedMs: Date.now() - startedAt,
      textChars: 0,
      linksCount: 0,
      sample: '',
      containsMatches: countNeedles('', options.contains),
      error: 'Defina FIRECRAWL_API_KEY no .env antes de rodar o teste',
    };
  }

  const baseUrl = (process.env.FIRECRAWL_BASE_URL || DEFAULT_FIRECRAWL_BASE_URL).replace(/\/$/, '');

  try {
    const response = await axios.post<FirecrawlResponse>(
      `${baseUrl}/v1/scrape`,
      {
        url: options.url,
        formats: ['markdown', 'html', 'links'],
        onlyMainContent: options.onlyMainContent,
        timeout: options.timeoutMs,
      },
      {
        timeout: options.timeoutMs + 5000,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const body = response.data;
    if (!body.success) {
      throw new Error(body.error || 'Firecrawl retornou success=false');
    }

    const markdown = normalizeText(body.data?.markdown);
    const metadata = body.data?.metadata || {};
    const title = typeof metadata.title === 'string'
      ? normalizeText(metadata.title)
      : undefined;

    return {
      ok: true,
      provider: 'firecrawl',
      elapsedMs: Date.now() - startedAt,
      statusCode: response.status,
      title,
      textChars: markdown.length,
      linksCount: body.data?.links?.length || 0,
      sample: sampleText(markdown),
      containsMatches: countNeedles(markdown, options.contains),
      metadata,
    };
  } catch (error: any) {
    return {
      ok: false,
      provider: 'firecrawl',
      elapsedMs: Date.now() - startedAt,
      textChars: 0,
      linksCount: 0,
      sample: '',
      error: error.response?.data?.error || error.message,
      statusCode: error.response?.status,
    };
  }
}

function printSummary(title: string, summary: ScrapeSummary, contains: string[]): void {
  console.log(`\n[${title}]`);
  console.log(`ok: ${summary.ok}`);
  console.log(`status: ${summary.statusCode || 'n/a'}`);
  console.log(`tempo: ${summary.elapsedMs}ms`);
  console.log(`titulo: ${summary.title || 'n/a'}`);
  console.log(`texto: ${summary.textChars} caracteres`);
  console.log(`links: ${summary.linksCount}`);

  if (summary.error) {
    console.log(`erro: ${summary.error}`);
  }

  if (contains.length > 0) {
    console.log('termos encontrados:');
    const matches = summary.containsMatches || countNeedles(summary.sample, contains);
    for (const [needle, found] of Object.entries(matches)) {
      console.log(`- ${needle}: ${found ? 'sim' : 'nao'}`);
    }
  }

  if (summary.sample) {
    console.log('\namostra:');
    console.log(summary.sample);
  }
}

async function writeOutput(outputPath: string, payload: unknown): Promise<void> {
  const resolvedPath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\nResultado salvo em: ${resolvedPath}`);
}

async function main(): Promise<void> {
  const options = parseOptions();

  console.log('='.repeat(72));
  console.log('TESTE ISOLADO FIRECRAWL VS HTML DIRETO');
  console.log('='.repeat(72));
  console.log(`URL: ${options.url}`);
  console.log(`Firecrawl onlyMainContent: ${options.onlyMainContent}`);

  const [direct, firecrawl] = await Promise.all([
    scrapeDirect(options.url, options.timeoutMs, options.contains),
    scrapeFirecrawl(options),
  ]);

  printSummary('HTML direto + Cheerio', direct, options.contains);
  printSummary('Firecrawl', firecrawl, options.contains);

  const comparison = {
    url: options.url,
    collectedAt: new Date().toISOString(),
    contains: options.contains,
    direct,
    firecrawl,
    delta: {
      firecrawlTextCharsMinusDirect: firecrawl.textChars - direct.textChars,
      firecrawlLinksMinusDirect: firecrawl.linksCount - direct.linksCount,
      firecrawlElapsedMsMinusDirect: firecrawl.elapsedMs - direct.elapsedMs,
    },
  };

  console.log('\n[Comparativo]');
  console.log(`delta texto: ${comparison.delta.firecrawlTextCharsMinusDirect}`);
  console.log(`delta links: ${comparison.delta.firecrawlLinksMinusDirect}`);
  console.log(`delta tempo: ${comparison.delta.firecrawlElapsedMsMinusDirect}ms`);

  if (options.output) {
    await writeOutput(options.output, comparison);
  }
}

main().catch(error => {
  console.error(`\nERRO: ${error.message}`);
  process.exitCode = 1;
});
