/**
 * Registry de adaptadores de tribunais
 * Permite registrar e acessar adaptadores por código
 */

import { ITribunalAdapter } from './ITribunalAdapter';
import { TJSPAdapter } from './TJSPAdapter';
import { TJMGAdapter } from './TJMGAdapter';
import { STJAdapter } from './STJAdapter';
import { STFAdapter } from './STFAdapter';
import { TRTAdapter } from './TRTAdapter';
import { TRFAdapter } from './TRFAdapter';

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
    // TJ-SP - API oficial
    this.register(new TJSPAdapter(process.env.TJSP_API_KEY));
    
    // TJ-MG - Scraper com CAPTCHA (apenas se tiver 2captcha key)
    if (process.env.TWOCAPTCHA_API_KEY || process.env.TJMG_SCRAPER_ENABLED === 'true') {
      this.register(new TJMGAdapter(process.env.TWOCAPTCHA_API_KEY));
    }
    
    // STJ - Scraper
    this.register(new STJAdapter());
    
    // STF - Scraper
    this.register(new STFAdapter());
    
    // TRT-2 (São Paulo) - mais comum
    this.register(new TRTAdapter(2));
    
    // TRF-3 (São Paulo) - mais comum
    this.register(new TRFAdapter(3));
  }
  
  /**
   * Registra um novo adaptador
   */
  register(adapter: ITribunalAdapter): void {
    this.adapters.set(adapter.codigo, adapter);
    console.log(`Tribunal adapter registrado: ${adapter.codigo}`);
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
