/**
 * Teste do Cache OAB
 */

import TribunalService from '../src/services/TribunalService';

async function main() {
  const oab = '361329 SP';
  const tribunal = 'TJSP';

  console.log('='.repeat(60));
  console.log(`TESTE DE CACHE OAB - ${oab} em ${tribunal}`);
  console.log('='.repeat(60));

  // Primeira busca (cache miss)
  console.log('\n[1] PRIMEIRA BUSCA (cache miss)');
  console.log('-'.repeat(40));

  const inicio1 = Date.now();
  const resultado1 = await TribunalService.buscarPorOABComCache(
    oab,
    tribunal,
    undefined,
    undefined,
    false
  );
  const tempo1 = Date.now() - inicio1;

  console.log(`  Do cache: ${resultado1.doCache}`);
  console.log(`  Processos: ${resultado1.processos.length}`);
  console.log(`  Tempo total: ${tempo1}ms`);
  console.log(`  Tempo interno: ${resultado1.tempoMs}ms`);

  if (resultado1.processos.length > 0) {
    console.log(`  Primeiro processo: ${resultado1.processos[0].numeroProcesso}`);
  }

  // Segunda busca (cache hit)
  console.log('\n[2] SEGUNDA BUSCA (cache hit)');
  console.log('-'.repeat(40));

  const inicio2 = Date.now();
  const resultado2 = await TribunalService.buscarPorOABComCache(
    oab,
    tribunal,
    undefined,
    undefined,
    false
  );
  const tempo2 = Date.now() - inicio2;

  console.log(`  Do cache: ${resultado2.doCache}`);
  console.log(`  Processos: ${resultado2.processos.length}`);
  console.log(`  Tempo total: ${tempo2}ms`);
  console.log(`  Tempo interno: ${resultado2.tempoMs}ms`);

  // Forcar refresh
  console.log('\n[3] BUSCA COM FORCE REFRESH (cache miss forcado)');
  console.log('-'.repeat(40));

  const inicio3 = Date.now();
  const resultado3 = await TribunalService.buscarPorOABComCache(
    oab,
    tribunal,
    undefined,
    undefined,
    true
  );
  const tempo3 = Date.now() - inicio3;

  console.log(`  Do cache: ${resultado3.doCache}`);
  console.log(`  Processos: ${resultado3.processos.length}`);
  console.log(`  Tempo total: ${tempo3}ms`);
  console.log(`  Tempo interno: ${resultado3.tempoMs}ms`);

  console.log('\n' + '='.repeat(60));
  console.log('RESUMO');
  console.log('='.repeat(60));
  console.log(`  Primeira busca (cache miss): ${tempo1}ms`);
  console.log(`  Segunda busca (cache hit): ${tempo2}ms`);
  console.log(`  Speedup: ${(tempo1 / tempo2).toFixed(1)}x mais rapido`);
  console.log('='.repeat(60));
}

main().catch(console.error);
