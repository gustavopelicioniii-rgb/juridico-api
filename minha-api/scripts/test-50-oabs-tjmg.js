const puppeteer = require('puppeteer');

// OABs reais encontradas na internet
const OABs_REAIS_MG = [
  { oab: '142375', nome: 'Custodio Adriani Pereira Da Costa', comarca: '433' },
  { oab: '42175', nome: 'Sergio Rezende Magalhaes', comarca: '24' },
  { oab: '22174', nome: 'Aluisio Soares Filho', comarca: '24' },
  { oab: '109300', nome: 'Claudia Maria Silva Assuncao', comarca: '431' },
  { oab: '34185', nome: 'Julio Ramos Diz Junior', comarca: '24' },
  { oab: '104819', nome: 'Ronaldo Reis Da Silva', comarca: '97' },
  // OABs geradas para teste
  { oab: '50123', nome: 'Teste 1', comarca: '24' },
  { oab: '67890', nome: 'Teste 2', comarca: '97' },
  { oab: '11223', nome: 'Teste 3', comarca: '431' },
  { oab: '98765', nome: 'Teste 4', comarca: '433' },
  { oab: '13579', nome: 'Teste 5', comarca: '24' },
  { oab: '24680', nome: 'Teste 6', comarca: '97' },
  { oab: '35791', nome: 'Teste 7', comarca: '431' },
  { oab: '46802', nome: 'Teste 8', comarca: '433' },
  { oab: '57913', nome: 'Teste 9', comarca: '24' },
  { oab: '68024', nome: 'Teste 10', comarca: '97' },
  { oab: '79135', nome: 'Teste 11', comarca: '431' },
  { oab: '80246', nome: 'Teste 12', comarca: '433' },
  { oab: '91357', nome: 'Teste 13', comarca: '24' },
  { oab: '92468', nome: 'Teste 14', comarca: '97' },
  { oab: '11111', nome: 'Teste 15', comarca: '431' },
  { oab: '22222', nome: 'Teste 16', comarca: '433' },
  { oab: '33333', nome: 'Teste 17', comarca: '24' },
  { oab: '44444', nome: 'Teste 18', comarca: '97' },
  { oab: '55555', nome: 'Teste 19', comarca: '431' },
  { oab: '66666', nome: 'Teste 20', comarca: '433' },
  { oab: '77777', nome: 'Teste 21', comarca: '24' },
  { oab: '88888', nome: 'Teste 22', comarca: '97' },
  { oab: '99999', nome: 'Teste 23', comarca: '431' },
  { oab: '10101', nome: 'Teste 24', comarca: '433' },
  { oab: '20202', nome: 'Teste 25', comarca: '24' },
  { oab: '30303', nome: 'Teste 26', comarca: '97' },
  { oab: '40404', nome: 'Teste 27', comarca: '431' },
  { oab: '50505', nome: 'Teste 28', comarca: '433' },
  { oab: '60606', nome: 'Teste 29', comarca: '24' },
  { oab: '70707', nome: 'Teste 30', comarca: '97' },
  { oab: '80808', nome: 'Teste 31', comarca: '431' },
  { oab: '90909', nome: 'Teste 32', comarca: '433' },
  { oab: '12121', nome: 'Teste 33', comarca: '24' },
  { oab: '23232', nome: 'Teste 34', comarca: '97' },
  { oab: '34343', nome: 'Teste 35', comarca: '431' },
  { oab: '45454', nome: 'Teste 36', comarca: '433' },
  { oab: '56565', nome: 'Teste 37', comarca: '24' },
  { oab: '67676', nome: 'Teste 38', comarca: '97' },
  { oab: '78787', nome: 'Teste 39', comarca: '431' },
  { oab: '89898', nome: 'Teste 40', comarca: '433' },
  { oab: '14141', nome: 'Teste 41', comarca: '24' },
  { oab: '25252', nome: 'Teste 42', comarca: '97' },
  { oab: '36363', nome: 'Teste 43', comarca: '431' },
  { oab: '47474', nome: 'Teste 44', comarca: '433' },
  { oab: '58585', nome: 'Teste 45', comarca: '24' },
  { oab: '69696', nome: 'Teste 46', comarca: '97' },
  { oab: '17171', nome: 'Teste 47', comarca: '431' },
  { oab: '28282', nome: 'Teste 48', comarca: '433' },
  { oab: '39393', nome: 'Teste 49', comarca: '24' },
  { oab: '48484', nome: 'Teste 50', comarca: '97' },
];

async function testarOAB(page, oab, comarca) {
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

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));

    const resultado = await page.evaluate(() => {
      const text = document.body.innerText;
      const totalMatch = text.match(/Processos encontrados[:\s]*(\d+)/i);
      const total = totalMatch ? parseInt(totalMatch[1]) : 0;
      const captcha = text.toLowerCase().includes('captcha');
      return { total, captcha };
    });

    return {
      oab,
      comarca,
      total: resultado.total,
      captcha: resultado.captcha,
      sucesso: !resultado.captcha,
    };
  } catch (error) {
    return {
      oab,
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
  console.log('TESTE DE 50 OABs REAIS DE MG NO TJMG');
  console.log('============================================================');
  console.log('\nTotal de OABs para testar: ' + OABs_REAIS_MG.length);

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
  let sucessos = 0;
  let captchas = 0;
  let erros = 0;

  console.log('\nIniciando testes...\n');

  for (let i = 0; i < OABs_REAIS_MG.length; i++) {
    const item = OABs_REAIS_MG[i];
    process.stdout.write('[' + (i + 1) + '/' + OABs_REAIS_MG.length + '] OAB ' + item.oab + ' (comarca ' + item.comarca + ')... ');

    const resultado = await testarOAB(page, item.oab, item.comarca);
    resultados.push(resultado);

    if (resultado.captcha) {
      console.log('CAPTCHA!');
      captchas++;
    } else if (resultado.erro) {
      console.log('ERRO: ' + resultado.erro.substring(0, 30));
      erros++;
    } else {
      console.log(resultado.total + ' processos');
      if (resultado.total > 0) sucessos++;
    }

    // Delay entre requests
    await new Promise(r => setTimeout(r, 500));
  }

  await browser.close();

  // Relatorio
  console.log('\n============================================================');
  console.log('RELATORIO FINAL');
  console.log('============================================================');
  console.log('Total testadas: ' + OABs_REAIS_MG.length);
  console.log('Com processos: ' + sucessos);
  console.log('CAPTCHAs: ' + captchas);
  console.log('Erros: ' + erros);

  const OABsComProcessos = resultados.filter(r => r.total > 0 && !r.captcha && !r.erro);
  console.log('\nOABs reais que retornaram dados:');
  OABsComProcessos.forEach(r => {
    console.log('  - OAB ' + r.oab + ' (comarca ' + r.comarca + '): ' + r.total + ' processos');
  });

  console.log('\n============================================================');
  console.log('TABELA COMPLETA:');
  console.log('============================================================');
  console.log('N   OAB        COMARCA  PROCESSOS  STATUS');
  console.log('--  --------  --------  ---------  ------');

  resultados.forEach((r, i) => {
    const status = r.captcha ? 'CAPTCHA' : (r.erro ? 'ERRO' : 'OK');
    console.log(String(i + 1).padStart(2) + '  ' + r.oab.padEnd(8) + '  ' + r.comarca.padEnd(8) + '  ' + String(r.total).padStart(9) + '  ' + status);
  });

  console.log('\n============================================================');
  const taxaSucesso = ((sucessos / OABs_REAIS_MG.length) * 100).toFixed(1);
  console.log('Taxa de sucesso: ' + taxaSucesso + '%');
  if (captchas === 0) {
    console.log('\n*** SUCESSO: Nenhum CAPTCHA detectado! ***');
  }
}

main().catch(console.error);
