/**
 * Teste direto da API DataJud para OAB 361329 SP
 * Não requer banco de dados - testa apenas a API pública
 */

import axios from 'axios';

const DATAJUD_API_KEY = process.env.DATAJUD_API_KEY || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const DATAJUD_BASE_URL = 'https://api-publica.datajud.cnj.jus.br';

async function main() {
  const oab = '361329';
  console.log('='.repeat(60));
  console.log(`BUSCA DIRETA DATAJUD - OAB ${oab}`);
  console.log('='.repeat(60));

  try {
    // Busca via wildcard no numeroProcesso (estratégia validada anteriormente)
    const response = await axios.post(
      `${DATAJUD_BASE_URL}/api_publica_tjsp/_search`,
      {
        query: {
          bool: {
            should: [
              { wildcard: { numeroProcesso: `*${oab}*` } },
            ],
          },
        },
        size: 100,
        sort: [{ dataAjuizamento: { order: 'desc' } }],
      },
      {
        headers: {
          Authorization: `APIKey ${DATAJUD_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const hits = response.data?.hits?.hits || [];
    console.log(`\nTotal de processos encontrados: ${hits.length}`);

    if (hits.length > 0) {
      // Mostrar estatísticas
      const classes = new Map<string, number>();
      const orgaos = new Map<string, number>();
      const anos = new Map<number, number>();

      hits.forEach((hit: any) => {
        const src = hit._source;
        if (src.classe) classes.set(src.classe, (classes.get(src.classe) || 0) + 1);
        if (src.orgaoJulgador) orgaos.set(src.orgaoJulgador, (orgaos.get(src.orgaoJulgador) || 0) + 1);
        if (src.dataAjuizamento) {
          const ano = parseInt(src.dataAjuizamento.toString().substring(0, 4));
          anos.set(ano, (anos.get(ano) || 0) + 1);
        }
      });

      console.log('\n--- Classes mais frequentes ---');
      [...classes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([c, n]) => {
        console.log(`  ${c}: ${n} processos`);
      });

      console.log('\n--- Órgãos mais frequentes ---');
      [...orgaos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([o, n]) => {
        console.log(`  ${o}: ${n} processos`);
      });

      console.log('\n--- Processos por ano ---');
      [...anos.entries()].sort((a, b) => b[0] - a[0]).forEach(([ano, n]) => {
        console.log(`  ${ano}: ${n} processos`);
      });

      console.log('\n--- Primeiros 5 processos ---');
      hits.slice(0, 5).forEach((hit: any, i: number) => {
        const src = hit._source;
        console.log(`\n${i + 1}. Processo: ${src.numeroProcesso}`);
        console.log(`   Classe: ${src.classe || 'N/A'}`);
        console.log(`   Órgão: ${src.orgaoJulgador || 'N/A'}`);
        console.log(`   Data: ${src.dataAjuizamento ? new Date(src.dataAjuizamento.toString().replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')).toLocaleDateString('pt-BR') : 'N/A'}`);
        console.log(`   Valor: ${src.valorCausa ? `R$ ${src.valorCausa.toLocaleString('pt-BR')}` : 'N/A'}`);
        if (src.assuntos && src.assuntos.length > 0) {
          console.log(`   Assunto: ${src.assuntos[0]}`);
        }
        console.log(`   NUP: ${src.numeroProcesso?.replace(/\D/g, '').substring(0, 17) || 'N/A'}`);
      });

      // Dados ricos disponíveis vs não disponíveis
      console.log('\n--- Dados disponíveis no DataJud ---');
      const sample = hits[0]._source;
      const campos = Object.keys(sample);
      console.log(`Campos indexados: ${campos.length}`);
      console.log(`  Principais: ${['numeroProcesso', 'classe', 'assuntos', 'orgaoJulgador', 'dataAjuizamento', 'valorCausa', 'movimentos', 'polo'].filter(c => campos.includes(c)).join(', ')}`);
      console.log(`  Ausentes no índice: partes, advogados (precisam de crawler ESAJ/PJe)`);
    }

  } catch (error: any) {
    if (error.response) {
      console.error(`\nERRO API: ${error.response.status} - ${error.response.statusText}`);
      console.error(error.response.data);
    } else {
      console.error(`\nERRO: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('NOTA: Dados de PARTES, ADVOGADOS e VALOR DA CAUSA');
  console.log('não estão disponíveis na API pública do DataJud.');
  console.log('Use os crawlers ESAJ/PJe para complementar.');
  console.log('='.repeat(60));
}

main().catch(console.error);
