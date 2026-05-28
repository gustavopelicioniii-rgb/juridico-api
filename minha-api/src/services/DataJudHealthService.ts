import axios from 'axios';
import { getDataJudApiKey, isDataJudMockEnabled } from '../config/datajud';

const DATAJUD_SMOKE_ENDPOINT = 'https://api-publica.datajud.cnj.jus.br/api_publica_tjsp/_search';
const CACHE_TTL_MS = 60_000;

type SmokeResult = {
  ok: boolean;
  mode: 'mock' | 'real' | 'unconfigured';
  status?: number;
  checkedAt: string;
  message?: string;
};

class DataJudHealthService {
  private cache?: { expiresAt: number; result: SmokeResult };

  async smokeCheck(force = false): Promise<SmokeResult> {
    if (!force && this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.result;
    }

    if (isDataJudMockEnabled()) {
      return this.store({
        ok: false,
        mode: 'mock',
        checkedAt: new Date().toISOString(),
        message: 'DATAJUD_MOCK=true',
      });
    }

    const apiKey = getDataJudApiKey();
    if (!apiKey) {
      return this.store({
        ok: false,
        mode: 'unconfigured',
        checkedAt: new Date().toISOString(),
        message: 'DATAJUD_API_KEY ausente',
      });
    }

    try {
      const response = await axios.post(
        DATAJUD_SMOKE_ENDPOINT,
        { query: { match_all: {} }, size: 0 },
        {
          timeout: 12_000,
          headers: {
            Authorization: `APIKey ${apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return this.store({
        ok: response.status >= 200 && response.status < 300,
        mode: 'real',
        status: response.status,
        checkedAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      const errorWithResponse = error as { response?: { status?: number; data?: { message?: string } }; message?: string };
      return this.store({
        ok: false,
        mode: 'real',
        status: errorWithResponse.response?.status,
        checkedAt: new Date().toISOString(),
        message: errorWithResponse.response?.data?.message || errorWithResponse.message || 'Falha no smoke check DataJud',
      });
    }
  }

  private store(result: SmokeResult): SmokeResult {
    this.cache = { result, expiresAt: Date.now() + CACHE_TTL_MS };
    return result;
  }
}

export default new DataJudHealthService();
