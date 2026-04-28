/**
 * Registry de adaptadores de tribunais
 * Permite registrar e acessar adaptadores por código
 *
 * Estratégia atual: usa DataJudAdapter (CNJ API Pública) para todos os tribunais.
 * Adapters legados (TJSPAdapter, TJMGAdapter, etc.) ficam disponíveis para
 * fallback ou casos específicos via DATAJUD_USE_LEGACY=true.
 */

import { ITribunalAdapter } from './ITribunalAdapter';
import { DataJudAdapter, DATAJUD_TRIBUNAIS } from './DataJudAdapter';
import { TJSPAdapter } from './TJSPAdapter';
import { TJMGAdapter } from './TJMGAdapter';
import { STJAdapter } from './STJAdapter';
import { STFAdapter } from './STFAdapter';
import { TRTAdapter } from './TRTAdapter';
import { TRFAdapter } from './TRFAdapter';
import logger from '../config/logger';

class TribunalAdapterRegistry {
  private adapters: Map<string, ITribunalAdapter> = new Map();
  private static instance: TribunalAdapterRegistry;

  private constructor() {
    this.registerDefaults();
  }

  static getInstance(): TribunalAdapterRegistry {
    if (!TribunalAdapterRegistry.instance) {
      TribunalAdapterRegistry.instance = new TribunalAdapterRegistry();
    }
    return TribunalAdapterRegistry.instance;
  }

  /**
   * Registra adaptadores padrão
   */
  private registerDefaults(): void {
    const useLegacy = process.env.DATAJUD_USE_LEGACY === 'true';
    const datajudKey = process.env.DATAJUD_API_KEY;

    if (useLegacy) {
      logger.info('Modo LEGACY ativado - usando adapters específicos por tribunal');
      this.registerLegacyAdapters();
      return;
    }

    // Modo padrão: DataJud para todos os tribunais
    logger.info(`Registrando ${Object.keys(DATAJUD_TRIBUNAIS).length} tribunais via DataJud API`);
    for (const [codigo, sigla] of Object.entries(DATAJUD_TRIBUNAIS)) {
      this.register(new DataJudAdapter(codigo, sigla, datajudKey));
    }
  }

  /**
   * Registra adapters legados (scrapers específicos)
   */
  private registerLegacyAdapters(): void {
    this.register(new TJSPAdapter(process.env.TJSP_API_KEY));

    if (process.env.TWOCAPTCHA_API_KEY || process.env.TJMG_SCRAPER_ENABLED === 'true') {
      this.register(new TJMGAdapter(process.env.TWOCAPTCHA_API_KEY));
    }

    this.register(new STJAdapter());
    this.register(new STFAdapter());
    this.register(new TRTAdapter(2));
    this.register(new TRFAdapter(3));
  }

  /**
   * Registra um novo adaptador
   */
  register(adapter: ITribunalAdapter): void {
    this.adapters.set(adapter.codigo.toUpperCase(), adapter);
  }

  /**
   * Retorna adaptador pelo código do tribunal
   */
  get(codigo: string): ITribunalAdapter | undefined {
    return this.adapters.get(codigo.toUpperCase());
  }

  /**
   * Lista todos os tribunais disponíveis
   */
  listar(): Array<{ codigo: string; usaCaptcha: boolean }> {
    return Array.from(this.adapters.values()).map(a => ({
      codigo: a.codigo,
      usaCaptcha: a.usaCaptcha,
    }));
  }

  /**
   * Verifica se um tribunal é suportado
   */
  isSuportado(codigo: string): boolean {
    return this.adapters.has(codigo.toUpperCase());
  }
}

export const registry = TribunalAdapterRegistry.getInstance();
export { ITribunalAdapter, DadosProcesso, DadosParte, DadosMovimentacao, ResultadoBusca } from './ITribunalAdapter';
export { TJSPAdapter } from './TJSPAdapter';
export { DataJudAdapter, DATAJUD_TRIBUNAIS } from './DataJudAdapter';
