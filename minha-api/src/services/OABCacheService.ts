/**
 * OABCacheService - Cache em memória para resultados de busca por OAB
 *
 * Este serviço armazena os resultados de busca por OAB em um Map em memória
 * com TTL (Time-To-Live). Quando a mesma OAB é consultada novamente,
 * os processos são retornados instantaneamente do cache sem chamar a API.
 *
 * O cache funciona em conjunto com o OABBuscaCache (banco) para persistência.
 * O cache em memória é o primeiro nível (L1) - mais rápido.
 * O banco é o segundo nível (L2) - persistente entre reinicializações.
 */

export interface CacheEntry {
  oab: string;
  tribunalCodigo: string;
  processos: string[]; // Números de processo
  totalProcessos: number;
  criadoEm: number; // timestamp ms
  expiraEm: number; // timestamp ms
  nome?: string;
}

export interface OABCacheStats {
  tamanho: number;
  hits: number;
  misses: number;
  hitsPercentual: number;
  totalConsultas: number;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutos

class OABCacheService {
  private cache: Map<string, CacheEntry> = new Map();
  private stats = { hits: 0, misses: 0 };

  private buildKey(oab: string, tribunalCodigo: string): string {
    return `${oab.toUpperCase().replace(/\s/g, '')}::${tribunalCodigo.toUpperCase()}`;
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() > entry.expiraEm;
  }

  /**
   * Obtém resultado cacheado para OAB + tribunal
   */
  get(oab: string, tribunalCodigo: string): CacheEntry | null {
    const key = this.buildKey(oab, tribunalCodigo);
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return entry;
  }

  /**
   * Armazena resultado de busca por OAB no cache
   */
  set(
    oab: string,
    tribunalCodigo: string,
    processos: string[],
    ttlMs: number = DEFAULT_TTL_MS,
    nome?: string
  ): void {
    const key = this.buildKey(oab, tribunalCodigo);
    const now = Date.now();

    this.cache.set(key, {
      oab: oab.toUpperCase().replace(/\s/g, ''),
      tribunalCodigo: tribunalCodigo.toUpperCase(),
      processos,
      totalProcessos: processos.length,
      criadoEm: now,
      expiraEm: now + ttlMs,
      nome,
    });
  }

  /**
   * Remove entrada do cache
   */
  invalidate(oab: string, tribunalCodigo: string): void {
    const key = this.buildKey(oab, tribunalCodigo);
    this.cache.delete(key);
  }

  /**
   * Limpa todo o cache
   */
  clear(): void {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0 };
  }

  /**
   * Limpa entradas expiradas
   */
  cleanup(): number {
    let removidos = 0;
    const entries = Array.from(this.cache.entries());
    for (const [key, entry] of entries) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        removidos++;
      }
    }
    return removidos;
  }

  /**
   * Retorna estatísticas do cache
   */
  getStats(): OABCacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      tamanho: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitsPercentual: total > 0 ? Math.round((this.stats.hits / total) * 100) : 0,
      totalConsultas: total,
    };
  }

  /**
   * Retorna todas as entradas válidas (não expiradas)
   */
  getAll(): CacheEntry[] {
    const resultado: CacheEntry[] = [];
    const values = Array.from(this.cache.values());
    for (const entry of values) {
      if (!this.isExpired(entry)) {
        resultado.push(entry);
      }
    }
    return resultado;
  }

  /**
   * Retorna o TTL atual em ms para uma entrada
   */
  getTTL(oab: string, tribunalCodigo: string): number {
    const entry = this.get(oab, tribunalCodigo);
    if (!entry) return -1;
    return Math.max(0, entry.expiraEm - Date.now());
  }
}

export default new OABCacheService();
