import axios from 'axios';

const API_KEY = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

async function test() {
  const client = axios.create({
    headers: { Authorization: `APIKey ${API_KEY}`, 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  // Sem zeros
  console.log('=== Teste DataJud OAB 361329 ===\n');

  const r1 = await client.post('https://api-publica.datajud.cnj.jus.br/api_publica_tjsp/_search', {
    query: { wildcard: { numeroProcesso: '*361329*' } },
    size: 500,
    sort: [{ dataAjuizamento: { order: 'desc' } }],
  });

  console.log('Sem zeros (361329):', r1.data.hits?.total?.value || 0);

  // Com zeros (formatação antiga)
  const r2 = await client.post('https://api-publica.datajud.cnj.jus.br/api_publica_tjsp/_search', {
    query: { wildcard: { numeroProcesso: '*000361329*' } },
    size: 500,
    sort: [{ dataAjuizamento: { order: 'desc' } }],
  });

  console.log('Com zeros (000361329):', r2.data.hits?.total?.value || 0);

  // Mostrar alguns números de processo para comparar
  console.log('\nPrimeiros 3 processos (sem zeros):');
  const hits1 = r1.data.hits?.hits || [];
  hits1.slice(0, 3).forEach((h: any) => console.log(' ', h._source.numeroProcesso));

  console.log('\nPrimeiros 3 processos (com zeros):');
  const hits2 = r2.data.hits?.hits || [];
  hits2.slice(0, 3).forEach((h: any) => console.log(' ', h._source.numeroProcesso));
}

test().catch(console.error);
