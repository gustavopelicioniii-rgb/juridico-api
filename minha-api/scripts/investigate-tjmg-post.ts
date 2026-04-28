/**
 * Investigação TJMG - Tentando POST (form submission simulado)
 */

import axios from 'axios';

async function main() {
  const OAB = '104819';

  console.log('Investigando TJMG via POST...\n');

  // Headers que um browser real enviaria
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Origin': 'https://www4.tjmg.jus.br',
    'Referer': 'https://www4.tjmg.jus.br/juridico/sf/index_oab.jsp',
  };

  try {
    // Primeiro, acessar o formulário inicial para obter cookies
    console.log('[1] Acessando formulário inicial...');
    const formPage = await axios.get(
      'https://www4.tjmg.jus.br/juridico/sf/index_oab.jsp',
      { headers, timeout: 15000 }
    );
    console.log(`Status: ${formPage.status}`);
    console.log(`Cookies: ${Object.keys(formPage.headers).filter(k => k.includes('cookie')).join(', ')}`);

    // Extrair possíveis tokens da página
    const setCookies = formPage.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookies)
      ? setCookies.map((c: string) => c.split(';')[0]).join('; ')
      : '';

    // POST para o resultado
    console.log('\n[2] Enviando POST com dados do formulário...');

    // Dados do formulário - parâmetros que o formulário submete
    const formData = new URLSearchParams({
      'ativoBaixado': 'X',
      'codigoOAB': OAB,
      'comrCodigo': '0',  // 0 = todas as comarcas
      'dataExpediente': 'null',
      'linhasPorPagina': '10',
      'natureza': '0',  // 0 = todas
      'nomeAdvogado': '',
      'numero': '1',
      'paginacao': 'S',
      'paginaNumero': '1',
      'tipoConsulta': '4',  // 4 = por OAB
      'tipoOAB': 'N',
      'ufOAB': 'MG',
    });

    const response = await axios.post(
      'https://www4.tjmg.jus.br/juridico/sf/proc_resultado_oab.jsp',
      formData.toString(),
      {
        headers: {
          ...headers,
          'Cookie': cookieHeader,
          'Content-Length': formData.toString().length.toString(),
        },
        maxRedirects: 0, // Não seguir redirects automaticamente
        timeout: 15000,
      }
    );

    console.log(`Status: ${response.status}`);
    console.log(`Redirect URL: ${response.headers['location'] || 'nenhum'}`);

    if (response.status === 302 || response.status === 303) {
      const redirectUrl = response.headers['location'];
      console.log(`Redirect para: ${redirectUrl}`);

      // Seguir o redirect
      if (redirectUrl) {
        console.log('\n[3] Seguindo redirect...');
        const fullUrl = redirectUrl.startsWith('http')
          ? redirectUrl
          : `https://www4.tjmg.jus.br/juridico/sf/${redirectUrl}`;

        const redirectResponse = await axios.get(fullUrl, {
          headers: { ...headers, 'Cookie': cookieHeader },
          timeout: 15000,
        });

        console.log(`Redirect Status: ${redirectResponse.status}`);
        const html = redirectResponse.data as string;
        console.log(`HTML Length: ${html.length}`);

        // Analisar resultado
        if (html.includes('Processos encontrados')) {
          const match = html.match(/Processos encontrados:\s*(\d+)/i);
          console.log(`\nProcessos encontrados: ${match ? match[1] : '?'}`);
        }

        // Procurar números de processo
        const processos = html.match(/\d{7}[\d\-\.]+/g) || [];
        console.log(`Números no HTML: ${processos.length}`);
        if (processos.length > 0) {
          console.log('Sample:', processos.slice(0, 3));
        }
      }
    } else {
      const html = response.data as string;
      console.log(`HTML Length: ${html.length}`);

      if (html.includes('Processos encontrados')) {
        const match = html.match(/Processos encontrados:\s*(\d+)/i);
        console.log(`\nProcessos encontrados: ${match ? match[1] : '?'}`);
      }
    }

  } catch (error: any) {
    console.log(`ERRO: ${error.message}`);
    if (error.response) {
      console.log(`Status: ${error.response.status}`);
      console.log(`Headers:`, JSON.stringify(error.response.headers, null, 2).substring(0, 500));
      if (error.response.data) {
        console.log(`Data preview:`, (error.response.data as string).substring(0, 1000));
      }
    }
  }
}

main().catch(console.error);
