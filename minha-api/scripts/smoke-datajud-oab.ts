/**
 * Authenticated real DataJud/OAB smoke test.
 *
 * Required:
 *   TEST_AUTH_PASSWORD=<password for the OAB login>
 *
 * Useful:
 *   API_BASE_URL=http://localhost:3000/api/v1
 *   TEST_AUTH_OAB=361329
 *   TEST_AUTH_NOME="Sidney da Silva"
 *   TEST_AUTH_TRIBUNAL=TJSP
 *   SMOKE_EXPECT_MIN_PROCESSES=1
 *   SMOKE_REQUIRE_REAL_DATAJUD=true
 */

import 'dotenv/config';
import axios from 'axios';

type ApiHealth = {
  status?: string;
  checks?: { datajud?: string };
  dataJud?: { ok?: boolean; mode?: string; status?: number; message?: string };
};

type LoginResponse = {
  accessToken: string;
  advogado: {
    id: string;
    oab: string;
    nome: string;
  };
};

type BuscaOabResponse = {
  sucesso?: boolean;
  status?: string;
  totalEncontrados?: number;
  processos?: unknown[];
  doCache?: boolean;
  tempoMs?: number;
  fontes?: unknown[];
  motivo?: string;
};

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000/api/v1';
const TEST_AUTH_OAB = process.env.TEST_AUTH_OAB || '361329';
const TEST_AUTH_NOME = process.env.TEST_AUTH_NOME || 'Sidney da Silva';
const TEST_AUTH_TRIBUNAL = (process.env.TEST_AUTH_TRIBUNAL || 'TJSP').toUpperCase();
const TEST_AUTH_PASSWORD = process.env.TEST_AUTH_PASSWORD || process.env.TEST_SENHA;
const EXPECT_MIN_PROCESSES = Number(process.env.SMOKE_EXPECT_MIN_PROCESSES || 1);
const REQUIRE_REAL_DATAJUD = process.env.SMOKE_REQUIRE_REAL_DATAJUD !== 'false';
const LIMIT_PROCESSES = Number(process.env.SMOKE_LIMIT_PROCESSES || Math.max(EXPECT_MIN_PROCESSES, 1));

function fail(message: string): never {
  throw new Error(message);
}

function assertConfigured(): void {
  if (!TEST_AUTH_PASSWORD) {
    fail('TEST_AUTH_PASSWORD is required. Do not commit or print this value.');
  }

  if (!Number.isFinite(EXPECT_MIN_PROCESSES) || EXPECT_MIN_PROCESSES < 0) {
    fail('SMOKE_EXPECT_MIN_PROCESSES must be a non-negative number.');
  }
}

async function main(): Promise<void> {
  assertConfigured();

  console.log('=== Authenticated DataJud/OAB smoke ===');
  console.log(`API: ${API_BASE_URL}`);
  console.log(`Identity: OAB ${TEST_AUTH_OAB} / ${TEST_AUTH_NOME}`);
  console.log(`Tribunal: ${TEST_AUTH_TRIBUNAL}`);

  const healthResponse = await axios.get<ApiHealth>(`${API_BASE_URL}/health`, { timeout: 20_000 });
  const health = healthResponse.data;
  console.log(`Health: ${health.status || 'unknown'} / DataJud: ${health.dataJud?.mode || 'unknown'} ${health.checks?.datajud || ''}`);

  if (REQUIRE_REAL_DATAJUD) {
    if (health.dataJud?.mode !== 'real' || health.dataJud?.ok !== true) {
      fail(`DataJud is not healthy in real mode: ${JSON.stringify(health.dataJud || {})}`);
    }
  }

  const loginResponse = await axios.post<LoginResponse>(
    `${API_BASE_URL}/auth/login`,
    { oab: TEST_AUTH_OAB, senha: TEST_AUTH_PASSWORD },
    { timeout: 20_000 }
  );

  const session = loginResponse.data;
  if (!session.accessToken || !session.advogado?.id) {
    fail('Login response did not include an access token and advogado id.');
  }
  console.log(`Authenticated: advogadoId=${session.advogado.id}, oab=${session.advogado.oab}`);

  const searchResponse = await axios.post<BuscaOabResponse>(
    `${API_BASE_URL}/tribunais/${TEST_AUTH_TRIBUNAL}/buscar-oab`,
    {
      oab: TEST_AUTH_OAB,
      nome: TEST_AUTH_NOME,
      advogadoId: session.advogado.id,
      forceRefresh: true,
      limiteProcessos: LIMIT_PROCESSES,
    },
    {
      timeout: 300_000,
      headers: { Authorization: `Bearer ${session.accessToken}` },
    }
  );

  const result = searchResponse.data;
  const returned = Array.isArray(result.processos) ? result.processos.length : 0;
  const total = Number(result.totalEncontrados || returned);

  console.log(
    `Search: status=${result.status || 'unknown'}, total=${total}, returned=${returned}, cache=${result.doCache ? 'yes' : 'no'}, tempoMs=${result.tempoMs ?? 'n/a'}`
  );

  if (!result.sucesso) {
    fail(`OAB search did not report success. motivo=${result.motivo || 'n/a'}`);
  }

  if (total < EXPECT_MIN_PROCESSES) {
    fail(`Expected at least ${EXPECT_MIN_PROCESSES} process(es), got ${total}. motivo=${result.motivo || 'n/a'}`);
  }

  console.log('Smoke passed.');
}

main().catch((error: unknown) => {
  const err = error as { response?: { status?: number; data?: unknown }; message?: string };
  const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message || String(error);
  console.error(`Smoke failed: ${detail}`);
  process.exit(1);
});
