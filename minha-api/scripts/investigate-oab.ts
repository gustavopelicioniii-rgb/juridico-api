/**
 * Investigação profunda: encontrar o campo e formato correto da OAB no DataJud
 */

import axios from 'axios';

const API_KEY = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const BASE_URL = 'https://api-publica.datajud.cnj.jus.br';

async function investigate() {
  const client = axios.create({
    headers: { Authorization: `APIKey ${API_KEY}`, 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  console.log('=== Investigacao Profunda OAB 361329 SP ===\n');

  // 1. Fazer uma query que retorna MUITOS resultados e inspecionar todos os campos
  console.log('1. Inspecionando todos os campos disponíveis no índice TJSP...\n');

  const rAll = await client.post(`${BASE_URL}/api_publica_tjsp/_search`, {
    query: { match_all: {} },
    size: 50,
    sort: [{ dataAjuizamento: { order: 'desc' } }],
  });

  const hits = rAll.data.hits?.hits || [];

  // Coletar TODOS os campos únicos
  const allFields = new Set<string>();
  for (const hit of hits) {
    const source = hit._source as any;
    function collectFields(obj: any, prefix = '') {
      if (obj && typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
          const fullKey = prefix ? `${prefix}.${key}` : key;
          allFields.add(fullKey);
          if (typeof obj[key] === 'object') {
            collectFields(obj[key], fullKey);
          }
        }
      }
    }
    collectFields(source);
  }

  console.log('   Campos encontrados (primeiros 50):');
  const sorted = Array.from(allFields).sort();
  console.log('   ' + sorted.slice(0, 50).join(', '));
  console.log(`   Total de campos únicos: ${allFields.size}`);

  // 2. Procurar campos que parecem OAB
  console.log('\n2. Campos que contem "oab", "adv", "parte", "nome":');
  for (const field of sorted) {
    if (field.toLowerCase().includes('oab') ||
        field.toLowerCase().includes('advog') ||
        field.toLowerCase().includes('parte') ||
        field.toLowerCase().includes('nome')) {
      console.log(`   ${field}`);
    }
  }

  // 3. Mostrar estrutura COMPLETA de UM processo (sem campos removidos)
  console.log('\n3. Estrutura completa do primeiro processo (campos > 0):');
  if (hits.length > 0) {
    console.log(JSON.stringify(hits[0]._source, null, 2).substring(0, 5000));
  }

  // 4. Testar busca OAB com diferentes campos
  console.log('\n4. Testando busca em todos os campos para OAB 361329:');

  const oabTest = '361329';
  const oabTest2 = '000361329';

  const camposParaTestar = [
    'polo.advogados.numeroOAB',
    'advogados.numeroOAB',
    'numeroOAB',
    'oab',
    'advogado.oab',
    'advogado.numeroOAB',
    'partes.advogados.numeroOAB',
    'parte.advogado.numeroOAB',
    'pessoa.nome',
    'nome',
    'nomeParte',
    'parte.nome',
  ];

  const tribunaisParaTestar = ['tjsp', 'tjrj', 'tjmg', 'tjrs', 'tjpr', 'tjdf', 'trt2', 'trf3'];

  for (const campo of camposParaTestar) {
    for (const tribunal of tribunaisParaTestar) {
      try {
        const r = await client.post(`${BASE_URL}/api_publica_${tribunal}/_search`, {
          query: { match: { [campo]: oabTest } },
          size: 1,
        });
        const total = r.data.hits?.total?.value || 0;
        if (total > 0) {
          console.log(`   ★ ${tribunal}.${campo} = ${total} resultados!`);
        }
      } catch { /* ignore */ }
    }
  }

  // 5. Wildcard search
  console.log('\n5. Testando wildcard em todos os campos string:');
  try {
    const r = await client.post(`${BASE_URL}/api_publica_tjsp/_search`, {
      query: { wildcard: { '*': '*361329*' } },
      size: 5,
    });
    console.log(`   wildcard '*': ${r.data.hits?.total?.value}`);
  } catch (e: any) {
    console.log(`   wildcard '*': ERRO - ${e.message}`);
  }

  try {
    const r = await client.post(`${BASE_URL}/api_publica_tjsp/_search`, {
      query: { wildcard: { numeroProcesso: '*361329*' } },
      size: 5,
    });
    console.log(`   wildcard numeroProcesso: ${r.data.hits?.total?.value}`);
  } catch (e: any) {
    console.log(`   wildcard numeroProcesso: ERRO - ${e.message}`);
  }

  // 6. Testar busca por número de processo conhecido que tenha OAB
  console.log('\n6. Buscando por processos que contenham "361329" no numero:');
  try {
    const r = await client.post(`${BASE_URL}/api_publica_tjsp/_search`, {
      query: { wildcard: { numeroProcesso: '*361329*' } },
      size: 10,
    });
    const h = r.data.hits?.hits || [];
    console.log(`   Encontrados: ${r.data.hits?.total?.value}`);
    for (const hit of h.slice(0, 3)) {
      console.log(`   Processo: ${hit._source.numeroProcesso}`);
    }
  } catch (e: any) {
    console.log(`   ERRO: ${e.message}`);
  }

  // 7. Verificar se existe um campo "Movimentação" que contenha OAB
  console.log('\n7. Procurar OAB dentro das movimentacoes:');
  try {
    const r = await client.post(`${BASE_URL}/api_publica_tjsp/_search`, {
      query: { match: { 'movimentos.descricao': '361329' } },
      size: 5,
    });
    console.log(`   Em movimentacoes.descricao: ${r.data.hits?.total?.value}`);
  } catch (e: any) {
    console.log(`   ERRO: ${e.message}`);
  }

  // 8. Tentar query mais ampla com MATCH em vez de termos
  console.log('\n8. Query ampla (match sem field especificado):');
  try {
    const r = await client.post(`${BASE_URL}/api_publica_tjsp/_search`, {
      query: { match: { _all: '361329' } },
      size: 5,
    });
    console.log(`   _all: ${r.data.hits?.total?.value}`);
  } catch (e: any) {
    console.log(`   _all: ${e.message}`);
  }

  // 9. Tentar query_string
  console.log('\n9. Query string:');
  try {
    const r = await client.post(`${BASE_URL}/api_publica_tjsp/_search`, {
      query: { query_string: { default_field: '*', query: '*361329*' } },
      size: 5,
    });
    console.log(`   query_string: ${r.data.hits?.total?.value}`);
  } catch (e: any) {
    console.log(`   query_string: ${e.message}`);
  }

  // 10. Verificar mappings do índice
  console.log('\n10. Verificando mappings do índice TJSP:');
  try {
    const r = await client.get(`${BASE_URL}/api_publica_tjsp/_mapping`);
    console.log('   (Mappings recebidos)');
    const idx = r.data;
    const idxName = Object.keys(idx)[0];
    const props = idx[idxName]?.mappings?.properties || {};
    const relevantFields = Object.keys(props).filter(k =>
      k.toLowerCase().includes('oab') ||
      k.toLowerCase().includes('advog') ||
      k.toLowerCase().includes('parte') ||
      k.toLowerCase().includes('polo')
    );
    console.log(`   Campos relevantes para OAB/Advogado/Parte:`);
    for (const f of relevantFields) {
      console.log(`   - ${f}: ${JSON.stringify(props[f])}`);
    }
    if (relevantFields.length === 0) {
      console.log('   Nenhum campo específico para OAB/Advogado/Parte encontrado.');
      console.log('   Todos os campos disponíveis:');
      console.log('   ' + Object.keys(props).join(', '));
    }
  } catch (e: any) {
    console.log(`   ERRO: ${e.message}`);
  }

  // 11. Busca simples de OAB sem formatação em TODOS os tribunais
  console.log('\n11. Busca OAB "361329" (sem zeros) em TODOS os tribunais:');
  const todosTribunais = [
    'stf','stj','tst','tse','stm',
    'tjsp','tjrj','tjmg','tjrs','tjba','tjpr','tjsc','tjgo','tjdft','tjpe','tjce','tjes','tjms','tjmt','tjp','tjrn','tjal','tjse','tjpi','tjma','tjpa','tjam','tjap','tjro','tjrr','tjac','tjto',
    'trf1','trf2','trf3','trf4','trf5','trf6',
    ...Array.from({length: 24}, (_, i) => `trt${i+1}`)
  ];

  let found = false;
  for (const t of todosTribunais) {
    try {
      const r = await client.post(`${BASE_URL}/api_publica_${t}/_search`, {
        query: { match: { 'polo.advogados.numeroOAB': oabTest } },
        size: 1,
      });
      if (r.data.hits?.total?.value > 0) {
        console.log(`   ★ ${t}: ${r.data.hits.total.value} resultados!`);
        found = true;
      }
    } catch { /* ignore */ }
  }
  if (!found) console.log('   Nenhum tribunal retornou resultados para OAB 361329');
}

investigate().catch(console.error);
