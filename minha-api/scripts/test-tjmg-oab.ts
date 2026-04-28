/**
 * Teste TJMG - Busca por OAB de Minas Gerais
 *
 * Valida as 3 estratégias:
 * 1. DataJud (API pública CNJ) - sem CAPTCHA
 * 2. Legacy direto (URL sem formulário) - sem CAPTCHA
 * 3. PJe - pode ter CAPTCHA
 */

import axios from 'axios';

const DATAJUD_API_KEY = process.env.DATAJUD_API_KEY || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

async function main() {
  // OAB de MG para teste (advogado real encontrado na pesquisa)
  const OAB_TESTE = '104819N MG';

  console.log('='.repeat(60));
  console.log(`TESTE TJMG - OAB: ${OAB_TESTE}`);
  console.log('='.repeat(60));

  // 1. Testar DataJud TJMG
  console.log('\n[1] DATAJUD TJMG (API pública CNJ)');
  console.log('-'.repeat(40));

  const oabNumero = OAB_TESTE.replace(/\D/g, '');

  try {
    const response = await axios.post(
      'https://api-publica.datajud.cnj.jus.br/api_publica_tjmg/_search',
      {
        query: {
          bool: {
            should: [
              { wildcard: { numeroProcesso: `*${oabNumero}*` } },
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
    console.log(`Processos encontrados: ${hits.length}`);

    if (hits.length > 0) {
      // Estatísticas
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
      [...classes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
        .forEach(([c, n]) => console.log(`  ${c}: ${n}`));

      console.log('\n--- Órgãos mais frequentes ---');
      [...orgaos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
        .forEach(([o, n]) => console.log(`  ${o}: ${n}`));

      console.log('\n--- Anos de ajuizamento ---');
      [...anos.entries()].sort((a, b) => b[0] - a[0])
        .forEach(([ano, n]) => console.log(`  ${ano}: ${n}`));

      console.log('\n--- Primeiros 3 processos ---');
      hits.slice(0, 3).forEach((hit: any, i: number) => {
        const src = hit._source;
        console.log(`\n${i + 1}. ${src.numeroProcesso}`);
        console.log(`   Classe: ${src.classe || 'N/A'}`);
        console.log(`   Órgão: ${src.orgaoJulgador || 'N/A'}`);
        if (src.dataAjuizamento) {
          const date = new Date(src.dataAjuizamento.toString().replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
          console.log(`   Data: ${date.toLocaleDateString('pt-BR')}`);
        }
        console.log(`   Valor: ${src.valorCausa ? `R$ ${src.valorCausa.toLocaleString('pt-BR')}` : 'N/A'}`);
      });
    } else {
      console.log('Nenhum processo encontrado via DataJud');
      console.log('NOTA: OAB pode não estar embedada no número do processo (formato diferente do TJSP)');
    }
  } catch (error: any) {
    if (error.response) {
      console.log(`ERRO API: ${error.response.status} - ${error.response.statusText}`);
      if (error.response.data) {
        console.log(JSON.stringify(error.response.data, null, 2).substring(0, 500));
      }
    } else {
      console.log(`ERRO: ${error.message}`);
    }
  }

  // 2. Mostrar URL direta do legacy
  console.log('\n[2] URL DIRETA LEGACY (sem CAPTCHA)');
  console.log('-'.repeat(40));
  console.log('URL testada via WebFetch (sem Puppeteer):');
  console.log(`https://www4.tjmg.jus.br/juridico/sf/proc_resultado_oab.jsp?`);
  console.log(`  ativoBaixado=X`);
  console.log(`  codigoOAB=${oabNumero}`);
  console.log(`  comrCodigo=0`);
  console.log(`  natureza=0`);
  console.log(`  tipoConsulta=4`);
  console.log(`  tipoOAB=N`);
  console.log(`  ufOAB=MG`);
  console.log(`  paginacao=S`);
  console.log(`  paginaNumero=1`);

  // 3. Tentar acesso direto via WebFetch
  console.log('\n[3] ACESSO DIRETO (HTTP puro)');
  console.log('-'.repeat(40));

  try {
    const url = `https://www4.tjmg.jus.br/juridico/sf/proc_resultado_oab.jsp?ativoBaixado=X&codigoOAB=${oabNumero}&comrCodigo=0&natureza=0&tipoConsulta=4&tipoOAB=N&ufOAB=MG&paginacao=S&paginaNumero=1`;
    const httpResponse = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        'Accept': 'text/html',
      },
    });

    const html = httpResponse.data as string;

    // Verificar se tem CAPTCHA
    if (html.includes('captcha') || html.includes('CAPTCHA')) {
      console.log('CAPTCHA detectado no HTML');
    } else {
      console.log('SUCESSO: HTML retornado sem CAPTCHA!');

      // Extrair processos do HTML
      const processosMatch = html.match(/PROCESSO\s*:\s*([\d\-]+)/gi) || [];
      console.log(`Processos encontrados no HTML: ${processosMatch.length}`);

      const totalMatch = html.match(/Processos encontrados:\s*(\d+)/i);
      if (totalMatch) {
        console.log(`Total registrado: ${totalMatch[1]}`);
      }

      // Mostrar sample
      if (processosMatch.length > 0) {
        console.log('\nPrimeiros 5 números de processo:');
        processosMatch.slice(0, 5).forEach((p, i) => {
          console.log(`  ${i + 1}. ${p}`);
        });
      }
    }
  } catch (error: any) {
    if (error.response) {
      console.log(`ERRO HTTP: ${error.response.status}`);
      if (error.response.status === 403) {
        console.log('Acesso bloqueado (403) - IP pode estar bloqueado');
      }
    } else {
      console.log(`ERRO: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('RESUMO DAS ESTRATÉGIAS ANTI-CAPTCHA');
  console.log('='.repeat(60));
  console.log('1. DATAJUD: API oficial CNJ - sem CAPTCHA, gratuito');
  console.log('   URL: api-publica.datajud.cnj.jus.br');
  console.log('2. LEGACY DIRETO: URL com parâmetros - pode funcionar');
  console.log('   URL: www4.tjmg.jus.br/juridico/sf/proc_resultado_oab.jsp');
  console.log('3. CRAWLER PUPPETEER: Fallback se above falharem');
  console.log('   Usa Stealth Plugin + delays randômicos');
  console.log('4. EVITAR 2CAPTCHA: Caro ($2.99/1000 CAPTCHAs)');
  console.log('   Melhor: cache de sessões + retry strategy');
  console.log('='.repeat(60));
}

main().catch(console.error);
