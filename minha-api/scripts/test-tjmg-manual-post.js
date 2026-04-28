const puppeteer = require('puppeteer');

async function main() {
  const OAB = '104819';

  console.log('============================================================');
  console.log('TESTE TJMG - POST MANUAL (bypass CAPTCHA)');
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
    // Carregar pagina para obter cookies
    // ============================================================
    console.log('\n[1] Carregando para obter cookies...');

    await page.goto(
      'https://www4.tjmg.jus.br/juridico/sf/proc_oab.jsp?comrCodigo=24&cbo_nome_comarca=24&numero=1',
      { waitUntil: 'networkidle2', timeout: 30000 }
    );
    await new Promise(r => setTimeout(r, 2000));

    // Obter cookies
    const cookies = await page.cookies();
    const cookieStr = cookies.map(c => c.name + '=' + c.value).join('; ');
    console.log('Cookies: ' + cookieStr.substring(0, 80));

    // ============================================================
    // ETAPA: Encontrar e executar o form submission via JS
    // ============================================================
    console.log('\n[2] Preenchendo via JavaScript...');

    const filled = await page.evaluate((oab) => {
      // Preencher input OAB
      const oabInput = document.querySelector('input[name="codigoOAB"]');
      if (oabInput) {
        oabInput.focus();
        // Simular digitacao
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        nativeInputValueSetter?.call(oabInput, oab);
        oabInput.dispatchEvent(new Event('input', { bubbles: true }));
        oabInput.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Selecionar selects
      const tipoSelect = document.querySelector('select[name="tipoOAB"]');
      if (tipoSelect) tipoSelect.value = 'N';

      const ufSelect = document.querySelector('select[name="ufOAB"]');
      if (ufSelect) ufSelect.value = 'MG';

      const ativoSelect = document.querySelector('select[name="ativoBaixado"]');
      if (ativoSelect) ativoSelect.value = 'X';

      const naturezaSelect = document.querySelector('select[name="natureza"]');
      if (naturezaSelect) naturezaSelect.value = '0';

      // Verificar valores
      return {
        oabValue: oabInput ? oabInput.value : null,
        oabName: oabInput ? oabInput.name : null,
        form: !!document.querySelector('form'),
        formAction: document.querySelector('form')?.action || null,
      };
    }, OAB);

    console.log('Preenchido:', JSON.stringify(filled));

    // ============================================================
    // Interceptar requisicoes para ver o que acontece no submit
    // ============================================================
    console.log('\n[3] Clicando submit e interceptando...');

    await page.setRequestInterception(true);

    const requests = [];
    const responses = [];

    page.on('request', request => {
      requests.push({
        url: request.url(),
        method: request.method(),
        postData: request.postData()?.substring(0, 200) || null,
      });
      request.continue();
    });

    page.on('response', response => {
      responses.push({
        url: response.url(),
        status: response.status(),
      });
    });

    // Clicar submit
    await page.click('input[type="submit"]');

    // Aguardar
    await new Promise(r => setTimeout(r, 10000));

    // Mostrar requests
    console.log('\nRequests:');
    requests.forEach((r, i) => {
      console.log('  ' + (i+1) + '. ' + r.method + ' ' + r.url.substring(0, 80));
      if (r.postData) console.log('      POST: ' + r.postData);
    });

    console.log('\nResponses:');
    responses.forEach((r, i) => {
      console.log('  ' + (i+1) + '. ' + r.status + ' ' + r.url.substring(0, 80));
    });

    // Ver resultado
    console.log('\n[4] URL: ' + page.url());

    const resultado = await page.evaluate(() => {
      const text = document.body.innerText;
      const totalMatch = text.match(/Processos encontrados[:\s]*(\d+)/i);
      const total = totalMatch ? parseInt(totalMatch[1]) : 0;
      const linhas = text.match(/PROCESSO\s*:\s*[\d\-\.]+/gi) || [];
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
      return { total, count: unique.length, processos: unique.slice(0, 20) };
    });

    console.log('\n=== RESULTADO ===');
    console.log('Total: ' + resultado.total + ' | Processos: ' + resultado.count);

    if (resultado.count > 0) {
      console.log('\nProcessos:');
      resultado.processos.forEach((p, i) => console.log('  ' + (i+1) + '. ' + p));
    }

  } catch (error) {
    console.error('ERRO:', error.message);
  } finally {
    await browser.close();
  }

  console.log('\n============================================================');
}

main().catch(console.error);
