const puppeteer = require('puppeteer');

// OABs REAIS que sabemos que tem processos (das pesquisas Google)
const OABs_REAIS = [
  { oab: '142375', nome: 'Custodio Adriani Pereira Da Costa', comarca: '433' },
  { oab: '42175', nome: 'Sergio Rezende Magalhaes', comarca: '24' },
  { oab: '22174', nome: 'Aluisio Soares Filho', comarca: '24' },
  { oab: '109300', nome: 'Claudia Maria Silva Assuncao', comarca: '431' },
  { oab: '34185', nome: 'Julio Ramos Diz Junior', comarca: '24' },
  { oab: '104819', nome: 'Ronaldo Reis Da Silva', comarca: '97' },
];

async function testarOAB(page, oab, comarca, nome) {
  try {
    const params = new URLSearchParams({
      ativoBaixado: 'X',
      codigoOAB: oab,
      comrCodigo: comarca,
      dataExpediente: 'null',
      linhasPorPagina: '50',
      natureza: '0',
      nomeAdvogado: '',
      numero: '1',
      paginacao: 'S',
      paginaNumero: '1',
      tipoConsulta: '4',
      tipoOAB: 'N',
      ufOAB: 'MG',
    });

    const url = 'https://www4.tjmg.jus.br/juridico/sf/proc_resultado_oab.jsp?' + params.toString();

    console.log('    URL: ' + url.substring(0, 100) + '...');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));

    const resultado = await page.evaluate(() => {
      const text = document.body.innerText;
      const totalMatch = text.match(/Processos encontrados[:\s]*(\d+)/i);
      const total = totalMatch ? parseInt(totalMatch[1]) : 0;
      const captcha = text.toLowerCase().includes('captcha');
      const nomeAdv = text.match(/Advogado[:\s]*([^\n]+)/i);
      return {
        total,
        captcha,
        nomeAdvogado: nomeAdv ? nomeAdv[1].trim() : '',
      };
    });

    return {
      oab,
      nome,
      comarca,
      total: resultado.total,
      captcha: resultado.captcha,
      nomeAdvogadoRetornado: resultado.nomeAdvogado,
      sucesso: !resultado.captcha,
    };
  } catch (error) {
    return {
      oab,
      nome,
      comarca,
      total: 0,
      captcha: false,
      erro: error.message,
      sucesso: false,
    };
  }
}

async function main() {
  console.log('============================================================');
  console.log('TESTE DE 6 OABs REAIS CONHECIDAS DE MG');
  console.log('============================================================');
  console.log('\nEstas OABs foram encontradas em pesquisas reais no Google.\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920x1080',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');

  const resultados = [];

  for (let i = 0; i < OABs_REAIS.length; i++) {
    const item = OABs_REAIS[i];
    console.log('[' + (i + 1) + '/' + OABs_REAIS.length + '] Testando OAB ' + item.oab + ' - ' + item.nome);
    console.log('    Comarca: ' + item.comarca);

    const resultado = await testarOAB(page, item.oab, item.comarca, item.nome);
    resultados.push(resultado);

    if (resultado.captcha) {
      console.log('    *** CAPTCHA DETECTADO! ***');
    } else if (resultado.erro) {
      console.log('    ERRO: ' + resultado.erro);
    } else {
      console.log('    Processos encontrados: ' + resultado.total);
      if (resultado.nomeAdvogadoRetornado) {
        console.log('    Advogado (retornado): ' + resultado.nomeAdvogadoRetornado);
      }
    }
    console.log('');

    await new Promise(r => setTimeout(r, 2000));
  }

  await browser.close();

  // Relatorio
  console.log('============================================================');
  console.log('RELATORIO FINAL - OABs REAIS DE MG');
  console.log('============================================================');

  let captchas = 0;
  let sucessos = 0;

  resultados.forEach((r, i) => {
    console.log('\n[' + (i + 1) + '] OAB ' + r.oab + ' - ' + r.nome);
    console.log('    Comarca: ' + r.comarca);
    if (r.captcha) {
      console.log('    *** CAPTCHA! ***');
      captchas++;
    } else if (r.erro) {
      console.log('    ERRO: ' + r.erro);
    } else {
      console.log('    Processos: ' + r.total);
      if (r.nomeAdvogadoRetornado) {
        console.log('    Advogado retornado: ' + r.nomeAdvogadoRetornado);
      }
      if (r.total > 0) sucessos++;
    }
  });

  console.log('\n============================================================');
  console.log('RESUMO:');
  console.log('============================================================');
  console.log('Total de OABs testadas: ' + OABs_REAIS.length);
  console.log('Sucedidas: ' + sucessos);
  console.log('CAPTCHAs detectados: ' + captchas);

  if (captchas === 0) {
    console.log('\n*** SUCESSO! Nenhum CAPTCHA foi detectado! ***');
    console.log('*** O metodo de bypass direto esta funcionando! ***');
  }
}

main().catch(console.error);
