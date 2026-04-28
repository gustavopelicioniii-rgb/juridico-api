const puppeteer = require('puppeteer');

async function main() {
  const OAB = '104819';

  console.log('============================================================');
  console.log('TESTE TJMG - Interceptando requisicao');
  console.log('============================================================');

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

  try {
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
    );

    // ============================================================
    // ETAPA 1: Carregar e interceptar requisicoes
    // ============================================================
    console.log('\n[1] Carregando pagina OAB...');

    // Interceptar todas as requisicoes
    await page.setRequestInterception(true);

    let lastRequest = null;
    let lastResponse = null;

    page.on('request', request => {
      lastRequest = {
        url: request.url(),
        method: request.method(),
        postData: request.postData(),
        headers: request.headers(),
      };
      request.continue();
    });

    page.on('response', response => {
      lastResponse = {
        url: response.url(),
        status: response.status(),
      };
    });

    await page.goto(
      'https://www4.tjmg.jus.br/juridico/sf/proc_oab.jsp?comrCodigo=24&cbo_nome_comarca=24&numero=1',
      { waitUntil: 'networkidle2', timeout: 30000 }
    );
    await new Promise(r => setTimeout(r, 2000));

    console.log('Pagina carregada');

    // Preencher formulario
    console.log('\n[2] Preenchendo OAB...');
    await page.click('input[name="codigoOAB"]', { clickCount: 3 });
    await page.keyboard.type(OAB);
    console.log('OAB preenchida');

    // Selecionar opcoes
    await page.evaluate(() => {
      // tipoOAB = N
      const s = document.querySelector('select[name="tipoOAB"]');
      if (s) for (const opt of s.options) if (opt.value === 'N') { opt.selected = true; break; }
      // ufOAB = MG
      const u = document.querySelector('select[name="ufOAB"]');
      if (u) for (const opt of u.options) if (opt.value === 'MG') { opt.selected = true; break; }
      // ativoBaixado = X
      const a = document.querySelector('select[name="ativoBaixado"]');
      if (a) for (const opt of a.options) if (opt.value === 'X') { opt.selected = true; break; }
      // natureza = 0
      const n = document.querySelector('select[name="natureza"]');
      if (n) for (const opt of n.options) if (opt.value === '0') { opt.selected = true; }
    });
    console.log('Opcoes OK');

    // ============================================================
    // ETAPA 2: Submeter via keyboard
    // ============================================================
    console.log('\n[3] Submetendo via Enter...');

    // Limpar o listener anterior para nao acumular
    page.removeAllListeners('request');
    page.removeAllListeners('response');

    await page.setRequestInterception(true);

    const requests = [];
    const responses = [];

    page.on('request', request => {
      requests.push({
        url: request.url(),
        method: request.method(),
        postData: request.postData(),
      });
      request.continue();
    });

    page.on('response', response => {
      responses.push({
        url: response.url(),
        status: response.status(),
      });
    });

    // Pressionar Enter
    await page.focus('input[name="codigoOAB"]');
    await page.keyboard.press('Enter');
    console.log('Enter pressionado');

    // Aguardar
    await new Promise(r => setTimeout(r, 10000));

    console.log('\n[4] Requisicoes interceptadas:');
    requests.forEach((r, i) => {
      console.log('  ' + (i+1) + '. ' + r.method + ' ' + r.url.substring(0, 80));
      if (r.postData) console.log('      POST: ' + r.postData.substring(0, 100));
    });

    console.log('\n[5] Respostas:');
    responses.forEach((r, i) => {
      console.log('  ' + (i+1) + '. ' + r.status + ' ' + r.url.substring(0, 80));
    });

    // ============================================================
    // ETAPA 3: Ver resultado
    // ============================================================
    console.log('\n[6] Resultado:');
    console.log('URL: ' + page.url());

    const resultado = await page.evaluate(() => {
      const text = document.body.innerText;
      const totalMatch = text.match(/Processos encontrados[:\s]*(\d+)/i);
      const total = totalMatch ? parseInt(totalMatch[1]) : 0;
      const linhas = text.match(/PROCESSO\s*:\s*[\d\-\.]+/gi) || [];
      return {
        total,
        linhasPROCESSO: linhas.length,
        snippet: text.substring(0, 1000),
      };
    });

    console.log('Total: ' + resultado.total);
    console.log('Linhas PROCESSO: ' + resultado.linhasPROCESSO);

    if (resultado.linhasPROCESSO > 0) {
      const processos = await page.evaluate(() => {
        const linhas = document.body.innerText.match(/PROCESSO\s*:\s*[\d\-\.]+/gi) || [];
        const seen = new Set();
        const unique = [];
        linhas.forEach(l => {
          const m = l.match(/PROCESSO\s*:\s*([\d\-\.]+)/i);
          if (m) {
            const num = m[1].replace(/\D/g, '');
            if (!seen.has(num) && num.length >= 7) {
              seen.add(num);
              unique.push(num);
            }
          }
        });
        return unique.slice(0, 10);
      });
      console.log('\nProcessos:');
      processos.forEach((p, i) => console.log('  ' + (i+1) + '. ' + p));
    } else {
      console.log('\n' + resultado.snippet);
    }

  } catch (error) {
    console.error('ERRO:', error.message);
  } finally {
    await browser.close();
  }

  console.log('\n============================================================');
}

main().catch(console.error);
