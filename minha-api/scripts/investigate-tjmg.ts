/**
 * Investigação TJMG - Entender estrutura real da resposta
 */

import axios from 'axios';

async function main() {
  const OAB = '104819';

  console.log('Investigando TJMG...\n');

  const url = `https://www4.tjmg.jus.br/juridico/sf/proc_resultado_oab.jsp?ativoBaixado=X&codigoOAB=${OAB}&comrCodigo=97&natureza=0&tipoConsulta=4&tipoOAB=N&ufOAB=MG&paginacao=S&paginaNumero=1`;

  console.log(`URL: ${url}\n`);

  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
      responseType: 'text',
      maxRedirects: 5,
    });

    const html = response.data as string;

    console.log(`Status: ${response.status}`);
    console.log(`Content-Length: ${html.length}`);
    console.log(`Encoding: ${response.headers['content-type']}`);

    // Verificar CAPTCHA
    if (html.includes('captcha') || html.includes('CAPTCHA')) {
      console.log('\nCAPTCHA detectado!');
      return;
    }

    // Mostrar início do HTML
    console.log('\n--- INÍCIO DO HTML (first 2000 chars) ---');
    console.log(html.substring(0, 2000));

    // Procurar por "Processos"
    const processosIdx = html.indexOf('Processos');
    if (processosIdx > 0) {
      console.log('\n--- TEXTO AO REDOR DE "Processos" ---');
      console.log(html.substring(processosIdx - 100, processosIdx + 300));
    }

    // Procurar padrão de processo
    const processoMatch = html.match(/.{0,100}PROCESSO.{0,100}/i);
    if (processoMatch) {
      console.log('\n--- PRIMEIRA OCORRÊNCIA DE "PROCESSO" ---');
      console.log(processoMatch[0]);
    }

    // Contar linhas com números de processo (formato TJMG)
    const numerosProcesso = html.match(/\d{7}[\d\-\.]+/g) || [];
    console.log(`\nNúmeros de processo encontrados: ${numerosProcesso.length}`);
    if (numerosProcesso.length > 0) {
      console.log('Primeiros 5:', numerosProcesso.slice(0, 5));
    }

  } catch (error: any) {
    console.log(`ERRO: ${error.message}`);
    if (error.response) {
      console.log(`Status: ${error.response.status}`);
      console.log(`Headers:`, JSON.stringify(error.response.headers, null, 2).substring(0, 500));
    }
  }
}

main().catch(console.error);
