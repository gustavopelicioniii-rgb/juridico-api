function envBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'sim'].includes(value.toLowerCase());
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const FIRECRAWL_CONFIG = {
  enabled: envBoolean(process.env.FIRECRAWL_ENABLED, false),
  apiKey: process.env.FIRECRAWL_API_KEY || '',
  baseUrl: (process.env.FIRECRAWL_BASE_URL || 'https://api.firecrawl.dev').replace(/\/$/, ''),
  timeoutMs: positiveNumber(process.env.FIRECRAWL_TIMEOUT_MS, 30000),
  cacheTtlSeconds: positiveNumber(process.env.FIRECRAWL_CACHE_TTL_SECONDS, 24 * 60 * 60),
  maxUrlsPerJob: Math.floor(positiveNumber(process.env.FIRECRAWL_MAX_URLS_PER_JOB, 5)),
  maxContentChars: Math.floor(positiveNumber(process.env.FIRECRAWL_MAX_CONTENT_CHARS, 12000)),
  onlyMainContent: envBoolean(process.env.FIRECRAWL_ONLY_MAIN_CONTENT, true),
} as const;

export function isFirecrawlReady(): boolean {
  return FIRECRAWL_CONFIG.enabled && Boolean(FIRECRAWL_CONFIG.apiKey);
}
