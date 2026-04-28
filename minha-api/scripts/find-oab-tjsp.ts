/**
 * Busca OAB 361329 SP - encontrou 106 processos!
 * A OAB está EMBUTIDA no numeroProcesso (padrão NUP/CNJ)
 */

import axios from 'axios';

const API_KEY = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const BASE_URL = 'https://api-publica.datajud.cnj.jus.br';

async function findByOAB() {
  const client = axios.create({
    headers: { Authorization: `APIKey ${API_KEY}`, 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  console.log('=== OAB 361329 SP - 106 processos encontrados ===\n');

  // Buscar TODOS os processos que contêm "361329" no número
  console.log('Buscando processos via wildcard numeroProcesso...\n');

  const r = await client.post(`${BASE_URL}/api_publica_tjsp/_search`, {
    query: { wildcard: { numeroProcesso: '*361329*' } },
    size: 200,
    sort: [{ dataAjuizamento: { order: 'desc' } }],
  });

  const hits = r.data.hits?.hits || [];
  const total = r.data.hits?.total?.value || 0;

  console.log(`Total de processos encontrados: ${total}\n`);

  if (hits.length === 0) {
    console.log('Nenhum processo retornado.');
    return;
  }

  // Mostrar todos os processos
  console.log('══════════════════════════════════════════════════════════');
  console.log(`OAB 361329 SP - Processos do advogado`);
  console.log('══════════════════════════════════════════════════════════\n');

  for (const hit of hits) {
    const p = hit._source;
    const numFmt = formatarNumeroProcesso(p.numeroProcesso);

    console.log(`─────────────────────────────────────────────────────`);
    console.log(`Processo: ${numFmt}`);
    console.log(`─────────────────────────────────────────────────────`);
    console.log(`Classe...: ${p.classe?.codigo} - ${p.classe?.nome}`);
    console.log(`Assunto..: ${p.assuntos?.map((a: any) => a.nome).join('; ')}`);
    console.log(`Sistema..: ${p.sistema?.nome}`);
    console.log(`Formato..: ${p.formato?.nome}`);
    console.log(`Grau....: ${p.grau}`);
    console.log(`Sigilo..: ${p.nivelSigilo}`);
    console.log(`Data Ajuizamento: ${formatarData(p.dataAjuizamento)}`);
    console.log(`Última atualização: ${formatarData(p.dataHoraUltimaAtualizacao)}`);
    console.log(`Órgão: ${p.orgaoJulgador?.nome}`);
    console.log(`Total Movimentações: ${p.movimentos?.length || 0}`);

    // Movimentações (últimas 5)
    if (p.movimentos && p.movimentos.length > 0) {
      console.log(`\nÚltimas movimentações:`);
      const ultimas = [...p.movimentos].reverse().slice(-5);
      for (const m of ultimas) {
        const data = m.dataHora ? new Date(m.dataHora).toLocaleDateString('pt-BR') : 'N/A';
        console.log(`  ${data} - [${m.codigo}] ${m.nome}`);
        if (m.complementosTabelados && m.complementosTabelados.length > 0) {
          for (const c of m.complementosTabelados) {
            console.log(`         └─ ${c.nome}: ${c.valor}`);
          }
        }
      }
    }
    console.log('');
  }

  // Estatísticas
  console.log('══════════════════════════════════════════════════════════');
  console.log('ESTATÍSTICAS DA OAB 361329 SP');
  console.log('══════════════════════════════════════════════════════════');

  const uniqueClasses = new Set(hits.map((h: any) => h._source.classe?.nome));
  const uniqueOrgaos = new Set(hits.map((h: any) => h._source.orgaoJulgador?.nome));
  const sistemas = hits.reduce((acc: any, h: any) => {
    const s = h._source.sistema?.nome || 'N/A';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log(`Total de processos: ${total}`);
  console.log(`Classes distintas: ${uniqueClasses.size}`);
  console.log(`Órgãos distintos: ${uniqueOrgaos.size}`);
  console.log(`Sistemas:`);
  for (const [s, count] of Object.entries(sistemas)) {
    console.log(`  ${s}: ${count}`);
  }

  // Processos por ano
  const porAno = hits.reduce((acc: any, h: any) => {
    const ano = h._source.dataAjuizamento?.substring(0, 4) || 'N/A';
    acc[ano] = (acc[ano] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log(`\nProcessos por ano:`);
  for (const [ano, count] of Object.entries(porAno).sort()) {
    console.log(`  ${ano}: ${count}`);
  }
}

function formatarNumeroProcesso(num: string): string {
  // Formata NUP para padrão visual brasileiro: NNNNNNN-DD.AAAA.J.TR.OOOO
  const clean = num.replace(/\D/g, '');
  if (clean.length >= 20) {
    return `${clean.slice(0,7)}-${clean.slice(7,9)}.${clean.slice(9,13)}.${clean.slice(13,15)}.${clean.slice(15,19)}.${clean.slice(19)}`;
  }
  return num;
}

function formatarData(data: string | undefined): string {
  if (!data) return 'N/A';
  try {
    // Data pode vir como "20250924144906" (YYYYMMDDHHMMSS) ou ISO
    if (data.length === 14) {
      return `${data.slice(6,8)}/${data.slice(4,6)}/${data.slice(0,4)} ${data.slice(8,10)}:${data.slice(10,12)}`;
    }
    return new Date(data).toLocaleString('pt-BR');
  } catch {
    return data;
  }
}

findByOAB().catch(console.error);
