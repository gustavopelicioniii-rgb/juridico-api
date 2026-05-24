/**
 * Teste em lote: health de tribunais + busca OAB com persistência no banco
 * Uso: npx ts-node scripts/test-batch-oab-api.ts
 */

import axios from 'axios';
import { DATAJUD_TRIBUNAIS } from '../src/tribunais/DataJudAdapter';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000/api/v1';
const LOGIN_OAB = process.env.TEST_OAB || 'MG123456';
const LOGIN_SENHA = process.env.TEST_SENHA || 'dev12345';

/** OAB usada em todos os tribunais (padrão wildcard DataJud no número do processo) */
const OAB_TESTE = process.env.OAB_LOTE || '361329';

const TODOS_TRIBUNAIS = Object.keys(DATAJUD_TRIBUNAIS).sort();

interface LoteItem {
  oab: string;
  tribunal: string;
  nome?: string;
}

/** Amostra ampliada por região + superiores */
const LOTE_OAB: LoteItem[] = [
  { oab: OAB_TESTE, tribunal: 'TJSP', nome: 'Sidney' },
  { oab: OAB_TESTE, tribunal: 'TJRJ' },
  { oab: OAB_TESTE, tribunal: 'TJMG' },
  { oab: OAB_TESTE, tribunal: 'TJRS' },
  { oab: OAB_TESTE, tribunal: 'TJBA' },
  { oab: OAB_TESTE, tribunal: 'TJPR' },
  { oab: OAB_TESTE, tribunal: 'TJDFT' },
  { oab: '104819', tribunal: 'TJMG' },
  { oab: '123456', tribunal: 'TJSP' },
  { oab: OAB_TESTE, tribunal: 'STJ' },
  { oab: OAB_TESTE, tribunal: 'STF' },
  { oab: OAB_TESTE, tribunal: 'TST' },
  { oab: OAB_TESTE, tribunal: 'TRF1' },
  { oab: OAB_TESTE, tribunal: 'TRF3' },
  { oab: OAB_TESTE, tribunal: 'TRT2' },
  { oab: OAB_TESTE, tribunal: 'TRT15' },
];

interface AuthSession {
  token: string;
  advogadoId: string;
}

interface ResultadoLote {
  oab: string;
  tribunal: string;
  sucesso: boolean;
  totalEncontrados: number;
  salvosNoBanco: number;
  doCache: boolean;
  tempoMs: number;
  erro?: string;
}

interface HealthTribunal {
  codigo: string;
  status: string;
  tempo: number | null;
}

async function login(): Promise<AuthSession> {
  const { data } = await axios.post(`${API_BASE}/auth/login`, {
    oab: LOGIN_OAB,
    senha: LOGIN_SENHA,
  });
  return {
    token: data.accessToken as string,
    advogadoId: data.advogado.id as string,
  };
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function verificarHealthTodos(token: string): Promise<HealthTribunal[]> {
  const chunks = chunkArray(TODOS_TRIBUNAIS, 25);
  const resultados: HealthTribunal[] = [];

  for (const chunk of chunks) {
    const { data } = await axios.get<{ tribunais: HealthTribunal[] }>(
      `${API_BASE}/tribunais/batch-status`,
      {
        params: { codigos: chunk.join(',') },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 120_000,
      }
    );
    resultados.push(...data.tribunais);
  }

  return resultados;
}

async function buscarOAB(
  session: AuthSession,
  item: LoteItem,
  forceRefresh: boolean
): Promise<ResultadoLote> {
  const inicio = Date.now();
  try {
    const { data } = await axios.post(
      `${API_BASE}/tribunais/${item.tribunal}/buscar-oab`,
      {
        oab: item.oab,
        nome: item.nome,
        advogadoId: session.advogadoId,
        forceRefresh,
      },
      {
        headers: { Authorization: `Bearer ${session.token}` },
        timeout: 300_000,
      }
    );

    const processos = data.processos ?? [];
    return {
      oab: item.oab,
      tribunal: item.tribunal,
      sucesso: true,
      totalEncontrados: data.totalEncontrados ?? processos.length,
      salvosNoBanco: processos.length,
      doCache: Boolean(data.doCache),
      tempoMs: data.tempoMs ?? Date.now() - inicio,
    };
  } catch (error: unknown) {
    const err = error as { response?: { data?: { erro?: { mensagem?: string } } }; message?: string };
    return {
      oab: item.oab,
      tribunal: item.tribunal,
      sucesso: false,
      totalEncontrados: 0,
      salvosNoBanco: 0,
      doCache: false,
      tempoMs: Date.now() - inicio,
      erro: err.response?.data?.erro?.mensagem || err.message || 'Erro desconhecido',
    };
  }
}

async function contarProcessosNoBanco(token: string, advogadoId: string): Promise<number> {
  const { data } = await axios.get<{ processos: unknown[] }>(
    `${API_BASE}/advogados/${advogadoId}/processos`,
    {
      headers: { Authorization: `Bearer ${token}` },
      params: { limite: 5000 },
    }
  );
  return data.processos?.length ?? 0;
}

async function main() {
  console.log('='.repeat(72));
  console.log('TESTE EM LOTE — tribunais + OAB com persistência no banco');
  console.log('='.repeat(72));
  console.log(`API: ${API_BASE}`);
  console.log(`Login: ${LOGIN_OAB}`);
  console.log(`Tribunais registrados (DataJud): ${TODOS_TRIBUNAIS.length}`);
  console.log(`Buscas OAB no lote: ${LOTE_OAB.length}\n`);

  const session = await login();
  console.log(`✅ Autenticado — advogadoId: ${session.advogadoId}\n`);

  // Fase 1: health de todos os tribunais
  console.log('--- FASE 1: Health check de todos os tribunais ---');
  const health = await verificarHealthTodos(session.token);
  const online = health.filter((t) => t.status === 'ONLINE');
  const offline = health.filter((t) => t.status === 'OFFLINE');
  const unknown = health.filter((t) => t.status === 'UNKNOWN');

  console.log(`  ONLINE:  ${online.length}/${health.length}`);
  console.log(`  OFFLINE: ${offline.length}/${health.length}`);
  console.log(`  UNKNOWN: ${unknown.length}/${health.length}`);

  if (offline.length > 0) {
    console.log('\n  Tribunais OFFLINE:');
    offline.forEach((t) => console.log(`    - ${t.codigo} (${t.tempo ?? '?'}ms)`));
  }
  if (unknown.length > 0) {
    console.log('\n  Tribunais UNKNOWN (não registrados no adapter):');
    unknown.forEach((t) => console.log(`    - ${t.codigo}`));
  }

  // Fase 2: buscas OAB com salvamento
  console.log('\n--- FASE 2: Busca OAB em lote (salvando no banco) ---');
  const resultados: ResultadoLote[] = [];

  for (let i = 0; i < LOTE_OAB.length; i++) {
    const item = LOTE_OAB[i];
    const label = `${item.tribunal} / OAB ${item.oab}`;
    process.stdout.write(`[${i + 1}/${LOTE_OAB.length}] ${label} ... `);

    const resultado = await buscarOAB(session, item, i === 0);
    resultados.push(resultado);

    if (resultado.sucesso) {
      console.log(
        `OK — ${resultado.totalEncontrados} proc | ${resultado.salvosNoBanco} no DB | cache: ${resultado.doCache ? 'sim' : 'não'} | ${resultado.tempoMs}ms`
      );
    } else {
      console.log(`ERRO — ${resultado.erro}`);
    }
  }

  const processosAdvogado = await contarProcessosNoBanco(session.token, session.advogadoId);

  console.log('\n--- FASE 3: Resumo persistência ---');
  console.log(`  Processos vinculados ao advogado ${LOGIN_OAB}: ${processosAdvogado}`);

  const sucessos = resultados.filter((r) => r.sucesso).length;
  const comProcessos = resultados.filter((r) => r.totalEncontrados > 0).length;
  const tempoTotal = resultados.reduce((acc, r) => acc + r.tempoMs, 0);

  console.log('\n' + '='.repeat(72));
  console.log('RELATÓRIO FINAL');
  console.log('='.repeat(72));
  console.log('HEALTH (todos os tribunais DataJud):');
  console.log(`  ONLINE:  ${online.length}/${TODOS_TRIBUNAIS.length}`);
  console.log(`  OFFLINE: ${offline.length}/${TODOS_TRIBUNAIS.length}`);
  console.log(`  UNKNOWN: ${unknown.length}/${TODOS_TRIBUNAIS.length}`);
  console.log('\nBUSCAS OAB:');
  console.log(`  Requisições:     ${resultados.length}`);
  console.log(`  Sucesso:         ${sucessos}/${resultados.length}`);
  console.log(`  Com processos:   ${comProcessos}/${resultados.length}`);
  console.log(`  Tempo total:     ${tempoTotal}ms`);
  console.log(`  Média por busca: ${Math.round(tempoTotal / Math.max(resultados.length, 1))}ms`);
  console.log(`  No banco (adv.): ${processosAdvogado} processos`);
  console.log('\nDetalhes buscas:');
  console.log('TRIBUNAL  OAB       PROC  DB   CACHE  TEMPO   STATUS');
  console.log('-'.repeat(72));
  for (const r of resultados) {
    const status = r.sucesso ? 'OK' : `ERRO: ${r.erro}`;
    console.log(
      `${r.tribunal.padEnd(9)} ${r.oab.padEnd(9)} ${String(r.totalEncontrados).padStart(4)}  ${String(r.salvosNoBanco).padStart(3)}  ${(r.doCache ? 'sim' : 'não ').padEnd(5)} ${String(r.tempoMs).padStart(5)}ms  ${status}`
    );
  }
  console.log('='.repeat(72));

  if (offline.length > 0 || unknown.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Falha no teste em lote:', error.response?.data || error.message || error);
  process.exit(1);
});
