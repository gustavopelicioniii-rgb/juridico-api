/**
 * Script de Validação dos Crawlers Multi-Tribunal
 *
 * Testa crawlers ESAJ/PJe com diferentes tribunais para validar
 * que a parametrização por baseUrl está funcionando corretamente.
 *
 * Uso:
 *   npx ts-node scripts/test-crawlers.ts
 *   npx ts-node scripts/test-crawlers.ts --tribunal TJSP
 *   npx ts-node scripts/test-crawlers.ts --oab "123456 SP"
 */

import { ESAJCrawler } from '../src/services/ESAJCrawler';
import { PJeCrawler } from '../src/services/PJeCrawler';
import { getCrawlerConfig, listTribunaisComCrawler } from '../src/config/tribunalCrawlers';

interface TestResult {
  tribunal: string;
  tipo: string;
  baseUrl: string;
  success: boolean;
  tempoMs: number;
  error?: string;
  processosEncontrados: number;
}

const TRIBUNAIS_ESAJ = ['TJSP', 'TJMG', 'TJRS', 'TJPR', 'TJBA', 'TJSC', 'TJGO', 'TJDFT'];
const TRIBUNAIS_PJE = ['TJRJ', 'TRT1', 'TRT2', 'TRT3', 'TRT4', 'TRF1', 'TRF2'];
const TRIBUNAIS_TESTE = [...TRIBUNAIS_ESAJ, ...TRIBUNAIS_PJE].slice(0, 5);

async function testarESAJCrawler(tribunal: string, oab?: string): Promise<TestResult> {
  const start = Date.now();
  const crawler = ESAJCrawler.forTribunal(tribunal);
  const config = getCrawlerConfig(tribunal);

  try {
    console.log(`\n🔍 Testando ESAJ Crawler para ${tribunal}...`);
    console.log(`   baseUrl: ${config?.baseUrl || 'default'}`);
    console.log(`   tipo: ${config?.tipo || 'default'}`);

    const oabTeste = oab || '361329 SP';
    const resultado = await crawler.buscarPorOAB(oabTeste);

    const tempo = Date.now() - start;
    console.log(`   ✅ Sucesso! ${resultado.total} processos em ${tempo}ms`);

    await crawler.close();
    return {
      tribunal,
      tipo: 'ESAJ',
      baseUrl: config?.baseUrl || 'default',
      success: true,
      tempoMs: tempo,
      processosEncontrados: resultado.total,
    };
  } catch (error: any) {
    const tempo = Date.now() - start;
    console.log(`   ❌ Erro: ${error.message}`);

    await crawler.close();
    return {
      tribunal,
      tipo: 'ESAJ',
      baseUrl: config?.baseUrl || 'default',
      success: false,
      tempoMs: tempo,
      error: error.message,
      processosEncontrados: 0,
    };
  }
}

async function testarPJECrawler(tribunal: string, oab?: string): Promise<TestResult> {
  const start = Date.now();
  const crawler = PJeCrawler.forTribunal(tribunal);
  const config = getCrawlerConfig(tribunal);

  try {
    console.log(`\n🔍 Testando PJe Crawler para ${tribunal}...`);
    console.log(`   baseUrl: ${config?.baseUrl || 'default'}`);
    console.log(`   tipo: ${config?.tipo || 'default'}`);

    const oabTeste = oab || '361329 SP';
    const resultado = await crawler.buscarPorOAB(oabTeste);

    const tempo = Date.now() - start;
    console.log(`   ✅ Sucesso! ${resultado.total} processos em ${tempo}ms`);

    await crawler.close();
    return {
      tribunal,
      tipo: 'PJe',
      baseUrl: config?.baseUrl || 'default',
      success: true,
      tempoMs: tempo,
      processosEncontrados: resultado.total,
    };
  } catch (error: any) {
    const tempo = Date.now() - start;
    console.log(`   ❌ Erro: ${error.message}`);

    await crawler.close();
    return {
      tribunal,
      tipo: 'PJe',
      baseUrl: config?.baseUrl || 'default',
      success: false,
      tempoMs: tempo,
      error: error.message,
      processosEncontrados: 0,
    };
  }
}

async function testarDetalheProcessoESAJ(tribunal: string, numeroProcesso?: string): Promise<TestResult> {
  const start = Date.now();
  const crawler = ESAJCrawler.forTribunal(tribunal);
  const config = getCrawlerConfig(tribunal);

  try {
    console.log(`\n🔍 Testando busca de detalhes ESAJ para ${tribunal}...`);

    const numero = numeroProcesso || '0000123-45.2023.8.26.0100';
    const resultado = await crawler.buscarDetalhesProcesso(numero);

    const tempo = Date.now() - start;
    const partes = resultado?.partes?.length || 0;
    console.log(`   ✅ Sucesso! ${partes} partes encontradas em ${tempo}ms`);

    await crawler.close();
    return {
      tribunal,
      tipo: 'ESAJ-DETALHE',
      baseUrl: config?.baseUrl || 'default',
      success: true,
      tempoMs: tempo,
      processosEncontrados: partes,
    };
  } catch (error: any) {
    const tempo = Date.now() - start;
    console.log(`   ❌ Erro: ${error.message}`);

    await crawler.close();
    return {
      tribunal,
      tipo: 'ESAJ-DETALHE',
      baseUrl: config?.baseUrl || 'default',
      success: false,
      tempoMs: tempo,
      error: error.message,
      processosEncontrados: 0,
    };
  }
}

async function runAllTests(tribunal?: string, oab?: string): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('     TESTE DE VALIDAÇÃO DOS CRAWLERS MULTI-TRIBUNAL');
  console.log('═══════════════════════════════════════════════════════════════');

  const resultados: TestResult[] = [];

  if (tribunal) {
    const config = getCrawlerConfig(tribunal);
    const tipo = config?.tipo || 'ESAJ';

    if (tipo === 'PJE') {
      resultados.push(await testarPJECrawler(tribunal, oab));
    } else {
      resultados.push(await testarESAJCrawler(tribunal, oab));
      resultados.push(await testarDetalheProcessoESAJ(tribunal));
    }
  } else {
    console.log('\n📋 Testando tribunais ESAJ...\n');
    for (const t of TRIBUNAIS_ESAJ.slice(0, 3)) {
      resultados.push(await testarESAJCrawler(t, oab));
    }

    console.log('\n📋 Testando tribunais PJe...\n');
    for (const t of TRIBUNAIS_PJE.slice(0, 2)) {
      resultados.push(await testarPJECrawler(t, oab));
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    RESUMO DOS TESTES');
  console.log('═══════════════════════════════════════════════════════════════');

  const sucessos = resultados.filter(r => r.success).length;
  const falhas = resultados.filter(r => !r.success).length;
  const tempoTotal = resultados.reduce((acc, r) => acc + r.tempoMs, 0);

  console.log(`\n Total de testes: ${resultados.length}`);
  console.log(` ✅ Sucessos: ${sucessos}`);
  console.log(` ❌ Falhas: ${falhas}`);
  console.log(` ⏱️  Tempo total: ${tempoTotal}ms`);

  console.log('\n📊 Detalhes:');
  for (const r of resultados) {
    const status = r.success ? '✅' : '❌';
    const erro = r.error ? ` - ${r.error.substring(0, 50)}` : '';
    console.log(`   ${status} ${r.tribunal} (${r.tipo}): ${r.tempoMs}ms - ${r.processosEncontrados} resultados${erro}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════');

  if (falhas > 0) {
    console.log('\n⚠️  ATENÇÃO: Alguns testes falharam!');
    console.log('   Verifique se os tribunais estão online e se não há bloqueios.');
    process.exit(1);
  } else {
    console.log('\n🎉 Todos os testes passaram!');
    process.exit(0);
  }
}

function listarTribunais(): void {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('              TRIBUNAIS COM SUPORTE A CRAWLER');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const tribunais = listTribunaisComCrawler();
  const porTipo: Record<string, string[]> = {};

  for (const t of tribunais) {
    const config = getCrawlerConfig(t);
    const tipo = config?.tipo || 'UNKNOWN';
    if (!porTipo[tipo]) porTipo[tipo] = [];
    porTipo[tipo].push(t);
  }

  for (const [tipo, lista] of Object.entries(porTipo)) {
    console.log(`\n${tipo} (${lista.length}):`);
    for (const t of lista.sort()) {
      const config = getCrawlerConfig(t);
      console.log(`   - ${t}: ${config?.baseUrl}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
}

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Uso: npx ts-node scripts/test-crawlers.ts [opções]

Opções:
  --tribunal <cod>   Testa um tribunal específico (ex: TJSP, TJRJ)
  --oab <numero>      OAB para teste (ex: "123456 SP")
  --list             Lista todos os tribunais suportados
  --help, -h         Mostra esta ajuda

Exemplos:
  npx ts-node scripts/test-crawlers.ts
  npx ts-node scripts/test-crawlers.ts --tribunal TJSP --oab "361329 SP"
  npx ts-node scripts/test-crawlers.ts --list
`);
  process.exit(0);
}

if (args.includes('--list')) {
  listarTribunais();
  process.exit(0);
}

const tribunalIdx = args.indexOf('--tribunal');
const oabIdx = args.indexOf('--oab');

const tribunal = tribunalIdx !== -1 ? args[tribunalIdx + 1] : undefined;
const oab = oabIdx !== -1 ? args[oabIdx + 1] : undefined;

runAllTests(tribunal, oab).catch(error => {
  console.error('❌ Erro fatal:', error);
  process.exit(1);
});
