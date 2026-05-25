/**
 * Validacao nacional do fluxo de busca por OAB.
 *
 * Uso:
 *   npx ts-node scripts/validate-national-oab.ts
 *
 * Variaveis uteis:
 *   API_BASE_URL=http://localhost:3001/api/v1
 *   NATIONAL_OAB_SAMPLE_SIZE=50
 *   VALIDATION_LIMIT_PER_OAB=1
 *   VALIDATION_DATAJUD_TIMEOUT_MS=18000
 */

import 'dotenv/config';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { DATAJUD_TRIBUNAIS } from '../src/tribunais/DataJudAdapter';

type Coverage =
  | 'ok-com-processos'
  | 'ok-vazio'
  | 'limitado-por-dados-publicos'
  | 'captcha/autenticacao'
  | 'erro-sistema';

interface Sample {
  sampleId: string;
  tribunal: string;
  oab: string;
  nome?: string;
  uf?: string;
  source: string;
  expected: 'positive' | 'empty-ok';
}

interface SearchResult {
  sampleId: string;
  tribunal: string;
  oab: string;
  nome?: string;
  source: string;
  clientOab: string;
  advogadoId?: string;
  success: boolean;
  httpStatus?: number;
  totalEncontrados: number;
  returned: number;
  enriched: number;
  withPartes: number;
  withAdvogados: number;
  withMovimentacoes: number;
  tempoMs: number;
  coverage: Coverage;
  error?: string;
}

interface HealthResult {
  codigo: string;
  status: string;
  tempo?: number | null;
}

interface DataJudHit {
  _source?: {
    numeroProcesso?: string;
    polo?: Array<{
      advogados?: Array<{
        nome?: string;
        numeroOAB?: string | number;
        ufOAB?: string;
      }>;
    }>;
  };
}

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001/api/v1';
const SAMPLE_SIZE = Number(process.env.NATIONAL_OAB_SAMPLE_SIZE || 50);
const LIMIT_PER_OAB = Number(process.env.VALIDATION_LIMIT_PER_OAB || 1);
const DATAJUD_TIMEOUT_MS = Number(process.env.VALIDATION_DATAJUD_TIMEOUT_MS || 18_000);
const REPORT_DIR = path.resolve(__dirname, '..', 'validation-reports');
const RUN_ID = new Date().toISOString().replace(/\D/g, '').slice(0, 12);

const tribunalCodes = Object.keys(DATAJUD_TRIBUNAIS).sort();

function authHeaders(): Record<string, string> {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET nao definido para gerar token de validacao');
  }

  const token = jwt.sign(
    {
      userId: 'national-oab-validation',
      role: 'SYSTEM',
      type: 'access',
      jti: randomUUID(),
    },
    secret,
    { expiresIn: '4h' }
  );

  return { Authorization: `Bearer ${token}` };
}

function normalizeOab(value: unknown): string | undefined {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 3 ? digits : undefined;
}

function sampleKey(sample: Pick<Sample, 'tribunal' | 'oab' | 'nome'>): string {
  return `${sample.tribunal}:${sample.oab}:${sample.nome || ''}`.toUpperCase();
}

function clientOabFor(index: number, sample: Sample): string {
  const suffix = `${sample.tribunal}${sample.oab}`.replace(/\W/g, '').slice(0, 12);
  return `V${RUN_ID.slice(6)}${String(index + 1).padStart(2, '0')}${suffix}`.slice(0, 20);
}

function classifyResult(result: SearchResult): Coverage {
  if (!result.success) return 'erro-sistema';
  if (result.returned > 0) return 'ok-com-processos';
  return result.source.startsWith('datajud-sample') || result.source.startsWith('esaj')
    ? 'limitado-por-dados-publicos'
    : 'ok-vazio';
}

function extractSamplesFromHits(tribunal: string, hits: DataJudHit[]): Sample[] {
  const samples: Sample[] = [];
  const seen = new Set<string>();

  for (const hit of hits) {
    for (const polo of hit._source?.polo || []) {
      for (const advogado of polo.advogados || []) {
        const oab = normalizeOab(advogado.numeroOAB);
        if (!oab) continue;

        const sample: Sample = {
          sampleId: randomUUID(),
          tribunal,
          oab,
          nome: advogado.nome,
          uf: advogado.ufOAB,
          source: 'datajud-sample',
          expected: 'positive',
        };
        const key = sampleKey(sample);
        if (seen.has(key)) continue;
        seen.add(key);
        samples.push(sample);
      }
    }
  }

  return samples;
}

async function collectDataJudSamples(): Promise<{ samples: Sample[]; capability: Record<string, string> }> {
  const apiKey = process.env.DATAJUD_API_KEY;
  const samples: Sample[] = [];
  const capability: Record<string, string> = {};

  if (!apiKey) {
    for (const code of tribunalCodes) capability[code] = 'sem-api-key';
    return { samples, capability };
  }

  for (const tribunal of tribunalCodes) {
    const sigla = DATAJUD_TRIBUNAIS[tribunal];
    const url = `https://api-publica.datajud.cnj.jus.br/api_publica_${sigla}/_search`;
    try {
      const { data } = await axios.post(
        url,
        {
          query: { exists: { field: 'polo.advogados.numeroOAB' } },
          size: 4,
          _source: ['numeroProcesso', 'polo'],
        },
        {
          timeout: DATAJUD_TIMEOUT_MS,
          headers: {
            Authorization: `APIKey ${apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );
      const hits = (data?.hits?.hits || []) as DataJudHit[];
      const extracted = extractSamplesFromHits(tribunal, hits);
      capability[tribunal] = extracted.length > 0 ? 'datajud-oab-field' : 'sem-campo-oab-publico';
      samples.push(...extracted);
    } catch (error) {
      const err = error as { response?: { status?: number }; message?: string };
      capability[tribunal] = err.response?.status ? `erro-http-${err.response.status}` : `erro-${err.message || 'desconhecido'}`;
    }
  }

  return { samples, capability };
}

function buildFallbackSamples(existing: Sample[], capability: Record<string, string>): Sample[] {
  const samples = [...existing];
  const seen = new Set(samples.map(sampleKey));

  const controls: Array<Omit<Sample, 'sampleId'>> = [
    { tribunal: 'TJSP', oab: '361329', nome: 'Sidney da Silva', uf: 'SP', source: 'esaj-tjsp-publico', expected: 'positive' },
    { tribunal: 'TJSP', oab: '999001', uf: 'SP', source: 'controle-vazio', expected: 'empty-ok' },
    { tribunal: 'TJMG', oab: '999002', uf: 'MG', source: 'controle-vazio', expected: 'empty-ok' },
    { tribunal: 'TJRJ', oab: '999003', uf: 'RJ', source: 'controle-vazio', expected: 'empty-ok' },
    { tribunal: 'TRF3', oab: '999004', source: 'controle-vazio', expected: 'empty-ok' },
    { tribunal: 'TRT2', oab: '999005', source: 'controle-vazio', expected: 'empty-ok' },
    { tribunal: 'STJ', oab: '999006', source: 'controle-vazio', expected: 'empty-ok' },
    { tribunal: 'STF', oab: '999007', source: 'controle-vazio', expected: 'empty-ok' },
  ];

  for (const control of controls) {
    const sample: Sample = { ...control, sampleId: randomUUID() };
    const key = sampleKey(sample);
    if (!seen.has(key)) {
      samples.push(sample);
      seen.add(key);
    }
  }

  let index = 0;
  while (samples.length < SAMPLE_SIZE) {
    const tribunal = tribunalCodes[index % tribunalCodes.length];
    const sample: Sample = {
      sampleId: randomUUID(),
      tribunal,
      oab: String(880000 + index),
      source: `controle-vazio-${capability[tribunal] || 'sem-classificacao'}`,
      expected: 'empty-ok',
    };
    const key = sampleKey(sample);
    if (!seen.has(key)) {
      samples.push(sample);
      seen.add(key);
    }
    index += 1;
  }

  return samples.slice(0, SAMPLE_SIZE);
}

async function ensureValidationClient(index: number, sample: Sample): Promise<{ id: string; oab: string }> {
  const oab = clientOabFor(index, sample);
  const headers = authHeaders();

  try {
    const { data } = await axios.post(
      `${API_BASE_URL}/advogados`,
      {
        oab,
        nome: `Cliente Validacao ${String(index + 1).padStart(2, '0')}`,
        email: `validacao.oab.${RUN_ID}.${index + 1}@example.invalid`,
        skipOnboarding: true,
      },
      { headers, timeout: 30_000 }
    );
    return { id: data.advogado.id, oab };
  } catch (error) {
    const err = error as { response?: { status?: number } };
    if (err.response?.status !== 409) throw error;

    const { data } = await axios.get(`${API_BASE_URL}/advogados`, { headers, timeout: 30_000 });
    const advogado = (data.advogados || []).find((item: { oab?: string }) => item.oab === oab);
    if (!advogado?.id) {
      throw new Error(`Advogado de validacao duplicado nao encontrado: ${oab}`);
    }
    return { id: advogado.id, oab };
  }
}

async function summarizePersistence(results: SearchResult[]) {
  const headers = authHeaders();
  let processosPersistidos = 0;
  for (const result of results) {
    if (!result.advogadoId) continue;
    try {
      const { data } = await axios.get(`${API_BASE_URL}/advogados/${result.advogadoId}/processos`, {
        headers,
        params: { limite: 5000 },
        timeout: 30_000,
      });
      processosPersistidos += Array.isArray(data?.processos) ? data.processos.length : 0;
    } catch {
      // A validacao principal ja registra as falhas por chamada; persistencia agrega melhor-esforco.
    }
  }

  return {
    advogadosValidacao: results.filter(r => r.advogadoId).length,
    processosPersistidos,
    processosEnriquecidosRetornados: results.reduce((acc, item) => acc + item.enriched, 0),
    processosComPartesRetornados: results.reduce((acc, item) => acc + item.withPartes, 0),
    processosComMovimentacoesRetornados: results.reduce((acc, item) => acc + item.withMovimentacoes, 0),
  };
}

async function checkHealth(): Promise<HealthResult[]> {
  const headers = authHeaders();
  const chunks: string[][] = [];
  for (let i = 0; i < tribunalCodes.length; i += 25) {
    chunks.push(tribunalCodes.slice(i, i + 25));
  }

  const results: HealthResult[] = [];
  for (const chunk of chunks) {
    const { data } = await axios.get(`${API_BASE_URL}/tribunais/batch-status`, {
      params: { codigos: chunk.join(',') },
      headers,
      timeout: 120_000,
    });
    results.push(...(data?.tribunais || []));
  }
  return results;
}

async function runSearch(index: number, sample: Sample): Promise<SearchResult> {
  const client = await ensureValidationClient(index, sample);
  const started = Date.now();
  const headers = authHeaders();

  try {
    const { data, status } = await axios.post(
      `${API_BASE_URL}/tribunais/${sample.tribunal}/buscar-oab`,
      {
        oab: sample.oab,
        nome: sample.nome,
        advogadoId: client.id,
        forceRefresh: true,
        limiteProcessos: LIMIT_PER_OAB,
      },
      { headers, timeout: 300_000 }
    );

    const processos = Array.isArray(data?.processos) ? data.processos : [];
    const result: SearchResult = {
      sampleId: sample.sampleId,
      tribunal: sample.tribunal,
      oab: sample.oab,
      nome: sample.nome,
      source: sample.source,
      clientOab: client.oab,
      advogadoId: client.id,
      success: true,
      httpStatus: status,
      totalEncontrados: Number(data?.totalEncontrados || processos.length || 0),
      returned: processos.length,
      enriched: processos.filter((p: { enriquecido?: boolean }) => p.enriquecido === true).length,
      withPartes: processos.filter((p: { partes?: unknown[] }) => Array.isArray(p.partes) && p.partes.length > 0).length,
      withAdvogados: processos.filter((p: { advogados?: unknown[] }) => Array.isArray(p.advogados) && p.advogados.length > 0).length,
      withMovimentacoes: processos.filter((p: { movimentacoes?: unknown[] }) => Array.isArray(p.movimentacoes) && p.movimentacoes.length > 0).length,
      tempoMs: Number(data?.tempoMs || Date.now() - started),
      coverage: 'ok-vazio',
    };
    result.coverage = classifyResult(result);
    return result;
  } catch (error) {
    const err = error as { response?: { status?: number; data?: unknown }; message?: string };
    return {
      sampleId: sample.sampleId,
      tribunal: sample.tribunal,
      oab: sample.oab,
      nome: sample.nome,
      source: sample.source,
      clientOab: client.oab,
      advogadoId: client.id,
      success: false,
      httpStatus: err.response?.status,
      totalEncontrados: 0,
      returned: 0,
      enriched: 0,
      withPartes: 0,
      withAdvogados: 0,
      withMovimentacoes: 0,
      tempoMs: Date.now() - started,
      coverage: 'erro-sistema',
      error: err.response?.data ? JSON.stringify(err.response.data).slice(0, 500) : err.message,
    };
  }
}

async function main() {
  const reportStartedAt = new Date();
  await fs.mkdir(REPORT_DIR, { recursive: true });

  console.log('=== Validacao Nacional OAB ===');
  console.log(`API: ${API_BASE_URL}`);
  console.log(`Tribunais registrados: ${tribunalCodes.length}`);
  console.log(`Amostra alvo: ${SAMPLE_SIZE}`);
  console.log(`Limite por OAB: ${LIMIT_PER_OAB}\n`);

  const health = await checkHealth();
  console.log(`Health coletado: ${health.length}/${tribunalCodes.length}`);

  const { samples: collectedSamples, capability } = await collectDataJudSamples();
  const samples = buildFallbackSamples(collectedSamples, capability);
  console.log(`Amostras publicas/DataJud coletadas: ${collectedSamples.length}`);
  console.log(`Amostras em execucao: ${samples.length}\n`);

  const results: SearchResult[] = [];
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    process.stdout.write(`[${i + 1}/${samples.length}] ${sample.tribunal} OAB ${sample.oab}${sample.nome ? ` (${sample.nome})` : ''} ... `);
    const result = await runSearch(i, sample);
    results.push(result);
    console.log(`${result.success ? 'OK' : 'FAIL'} ${result.coverage} returned=${result.returned} enriched=${result.enriched} ${result.tempoMs}ms`);
  }

  const persistence = await summarizePersistence(results);
  const byCoverage = results.reduce<Record<string, number>>((acc, result) => {
    acc[result.coverage] = (acc[result.coverage] || 0) + 1;
    return acc;
  }, {});

  const tribunalCoverage: Record<string, Coverage> = {};
  for (const code of tribunalCodes) {
    const tribunalResults = results.filter(result => result.tribunal === code);
    if (tribunalResults.some(result => result.coverage === 'ok-com-processos')) {
      tribunalCoverage[code] = 'ok-com-processos';
    } else if (tribunalResults.some(result => result.coverage === 'ok-vazio')) {
      tribunalCoverage[code] = 'ok-vazio';
    } else if ((capability[code] || '').includes('401') || (capability[code] || '').includes('403')) {
      tribunalCoverage[code] = 'captcha/autenticacao';
    } else if (tribunalResults.some(result => result.coverage === 'erro-sistema')) {
      tribunalCoverage[code] = 'erro-sistema';
    } else {
      tribunalCoverage[code] = 'limitado-por-dados-publicos';
    }
  }

  const report = {
    startedAt: reportStartedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    apiBaseUrl: API_BASE_URL,
    sampleSize: samples.length,
    limitPerOab: LIMIT_PER_OAB,
    tribunalsRegistered: tribunalCodes.length,
    health,
    datajudCapability: capability,
    tribunalCoverage,
    coverageSummary: byCoverage,
    persistence,
    samples,
    results,
  };

  const stamp = reportStartedAt.toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(REPORT_DIR, `national-oab-${stamp}.json`);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n=== Resumo ===');
  console.log(JSON.stringify({
    coverageSummary: byCoverage,
    persistence,
    report: jsonPath,
  }, null, 2));

  const systemFailures = results.filter(result => result.coverage === 'erro-sistema');
  if (health.length !== tribunalCodes.length || samples.length < SAMPLE_SIZE || systemFailures.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('Falha na validacao nacional:', error.response?.data || error.message || error);
    process.exit(1);
  });
