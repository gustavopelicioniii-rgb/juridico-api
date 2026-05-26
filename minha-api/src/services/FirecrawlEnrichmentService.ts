import axios from 'axios';
import crypto from 'crypto';
import { FIRECRAWL_CONFIG, isFirecrawlReady } from '../config/firecrawl';
import { cache, CACHE_KEYS } from '../config/redis';
import logger from '../config/logger';
import Processo from '../models/Processo';

type FirecrawlProvider = 'firecrawl';
type FirecrawlSourceType = 'auxiliary';

interface FirecrawlScrapeResponse {
  success?: boolean;
  data?: {
    markdown?: string;
    html?: string;
    links?: string[];
    metadata?: Record<string, unknown>;
  };
  error?: string;
}

export interface FirecrawlAuxResult {
  provider: FirecrawlProvider;
  tipoFonte: FirecrawlSourceType;
  oficial: false;
  unofficial: true;
  url: string;
  ok: boolean;
  capturedAt: string;
  cached: boolean;
  elapsedMs: number;
  statusCode?: number;
  title?: string;
  markdown?: string;
  markdownTruncated?: boolean;
  textChars: number;
  linksCount: number;
  links?: string[];
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface FirecrawlProcessEnrichment {
  provider: FirecrawlProvider;
  tipoFonte: FirecrawlSourceType;
  oficial: false;
  unofficial: true;
  processoId: string;
  numeroProcesso: string;
  updatedAt: string;
  results: FirecrawlAuxResult[];
}

interface EnrichProcessoParams {
  processoId: string;
  urls: string[];
  forceRefresh?: boolean;
  onlyMainContent?: boolean;
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`URL invalida para Firecrawl: ${value}`);
  }
  return url.toString();
}

function cacheKey(url: string, onlyMainContent: boolean): string {
  const hash = crypto
    .createHash('sha256')
    .update(`${url}|main:${onlyMainContent}`)
    .digest('hex');
  return `${CACHE_KEYS.FIRECRAWL_AUX}:url:${hash}`;
}

function trimMarkdown(markdown: string): { markdown: string; truncated: boolean } {
  const max = FIRECRAWL_CONFIG.maxContentChars;
  if (markdown.length <= max) {
    return { markdown, truncated: false };
  }
  return { markdown: markdown.slice(0, max), truncated: true };
}

function getTitle(metadata?: Record<string, unknown>): string | undefined {
  const value = metadata?.title || metadata?.ogTitle || metadata?.['og:title'];
  return typeof value === 'string' ? value : undefined;
}

class FirecrawlEnrichmentService {
  isEnabled(): boolean {
    return FIRECRAWL_CONFIG.enabled;
  }

  isReady(): boolean {
    return isFirecrawlReady();
  }

  validateUrls(urls: string[]): string[] {
    const maxUrls = FIRECRAWL_CONFIG.maxUrlsPerJob;
    if (!Array.isArray(urls) || urls.length === 0) {
      throw new Error('Informe ao menos uma URL publica para enriquecimento Firecrawl.');
    }
    if (urls.length > maxUrls) {
      throw new Error(`Firecrawl aceita no maximo ${maxUrls} URLs por job.`);
    }
    return Array.from(new Set(urls.map(normalizeUrl)));
  }

  async scrapeUrl(
    url: string,
    options: { forceRefresh?: boolean; onlyMainContent?: boolean } = {}
  ): Promise<FirecrawlAuxResult> {
    if (!this.isReady()) {
      throw new Error('Firecrawl desativado ou sem FIRECRAWL_API_KEY configurada.');
    }

    const onlyMainContent = options.onlyMainContent ?? FIRECRAWL_CONFIG.onlyMainContent;
    const normalizedUrl = normalizeUrl(url);
    const key = cacheKey(normalizedUrl, onlyMainContent);

    if (!options.forceRefresh) {
      const cached = await cache.get(key);
      if (cached) {
        return { ...JSON.parse(cached), cached: true };
      }
    }

    const startedAt = Date.now();
    const capturedAt = new Date().toISOString();

    try {
      const response = await axios.post<FirecrawlScrapeResponse>(
        `${FIRECRAWL_CONFIG.baseUrl}/v1/scrape`,
        {
          url: normalizedUrl,
          formats: ['markdown', 'links'],
          onlyMainContent,
          timeout: FIRECRAWL_CONFIG.timeoutMs,
        },
        {
          timeout: FIRECRAWL_CONFIG.timeoutMs + 5000,
          headers: {
            Authorization: `Bearer ${FIRECRAWL_CONFIG.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.data.success) {
        throw new Error(response.data.error || 'Firecrawl retornou success=false');
      }

      const metadata = response.data.data?.metadata;
      const markdownRaw = response.data.data?.markdown || '';
      const { markdown, truncated } = trimMarkdown(markdownRaw);

      const result: FirecrawlAuxResult = {
        provider: 'firecrawl',
        tipoFonte: 'auxiliary',
        oficial: false,
        unofficial: true,
        url: normalizedUrl,
        ok: true,
        capturedAt,
        cached: false,
        elapsedMs: Date.now() - startedAt,
        statusCode: response.status,
        title: getTitle(metadata),
        markdown,
        markdownTruncated: truncated,
        textChars: markdownRaw.length,
        linksCount: response.data.data?.links?.length || 0,
        links: response.data.data?.links,
        metadata,
      };

      await cache.set(key, JSON.stringify(result), FIRECRAWL_CONFIG.cacheTtlSeconds);
      return result;
    } catch (error: unknown) {
      const responseData = axios.isAxiosError(error) ? error.response?.data : undefined;
      const responseError = responseData && typeof responseData === 'object' && 'error' in responseData
        ? String(responseData.error)
        : undefined;
      const errorMessage = responseError || (error instanceof Error ? error.message : 'Erro desconhecido');

      const result: FirecrawlAuxResult = {
        provider: 'firecrawl',
        tipoFonte: 'auxiliary',
        oficial: false,
        unofficial: true,
        url: normalizedUrl,
        ok: false,
        capturedAt,
        cached: false,
        elapsedMs: Date.now() - startedAt,
        statusCode: axios.isAxiosError(error) ? error.response?.status : undefined,
        textChars: 0,
        linksCount: 0,
        error: errorMessage,
      };

      await cache.set(key, JSON.stringify(result), Math.min(FIRECRAWL_CONFIG.cacheTtlSeconds, 15 * 60));
      return result;
    }
  }

  async enrichProcesso(params: EnrichProcessoParams): Promise<FirecrawlProcessEnrichment> {
    const urls = this.validateUrls(params.urls);
    const processo = await Processo.findByPk(params.processoId);

    if (!processo) {
      throw new Error(`Processo nao encontrado: ${params.processoId}`);
    }

    const results: FirecrawlAuxResult[] = [];
    for (const url of urls) {
      const result = await this.scrapeUrl(url, {
        forceRefresh: params.forceRefresh,
        onlyMainContent: params.onlyMainContent,
      });
      results.push(result);
    }

    const enrichment: FirecrawlProcessEnrichment = {
      provider: 'firecrawl',
      tipoFonte: 'auxiliary',
      oficial: false,
      unofficial: true,
      processoId: processo.id,
      numeroProcesso: processo.numeroProcesso,
      updatedAt: new Date().toISOString(),
      results,
    };

    const dadosOriginais = (processo.dadosOriginais ?? {}) as Record<string, unknown>;
    await processo.update({
      dadosOriginais: {
        ...dadosOriginais,
        firecrawlAux: enrichment,
      },
    });

    logger.info('Enriquecimento auxiliar Firecrawl salvo', {
      processoId: processo.id,
      numeroProcesso: processo.numeroProcesso,
      totalUrls: urls.length,
      totalOk: results.filter(result => result.ok).length,
    });

    return enrichment;
  }
}

export default new FirecrawlEnrichmentService();
