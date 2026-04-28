const puppeteer = require('puppeteer');

async function main() {
  const OAB = '104819';

  console.log('============================================================');
  console.log('TESTE TJMG - INJETAR MOCK DWR');
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
    // ESTRATEGIA: Interceptar no nivel de response da chamada
    // DWR CAPTCHA para mockar a resposta
    // ============================================================

    console.log('\n[1] Carregando pagina OAB...');

    await page.goto(
      'https://www4.tjmg.jus.br/juridico/sf/proc_oab.jsp?comrCodigo=24&cbo_nome_comarca=24&numero=1',
      { waitUntil: 'networkidle2', timeout: 30000 }
    );
    await new Promise(r => setTimeout(r, 2000));

    // ============================================================
    // INJETAR MOCK: Substituir a funcao DWR que verifica CAPTCHA
    // ============================================================
    console.log('\n[2] Injentando mock DWR...');

    await page.evaluateOnNewDocument(() => {
      // Guardar a funcao original
      window.__originalExibirCaptcha = null;

      // Interceptar chamadas DWR
      const originalFetch = window.fetch;
      window.fetch = async function(...args) {
        const url = args[0]?.url || args[0];
        const urlStr = typeof url === 'string' ? url : url.toString();

        if (urlStr && urlStr.includes('ValidacaoCaptchaAction')) {
          console.log('[MOCK DWR] Interceptando ValidacaoCaptchaAction');
          // Retornar resposta mockada: "nao precisa de CAPTCHA"
          return new Response('// MOCK: sem CAPTCHA necessario', {
            status: 200,
            headers: { 'Content-Type': 'text/javascript' },
          });
        }

        return originalFetch.apply(this, args);
      };
    });

    await new Promise(r => setTimeout(r, 1000));

    // Verificar se mock foi injetado
    const mockStatus = await page.evaluate(() => {
      return {
        hasFetch: typeof window.fetch === 'function',
        hasOriginal: window.__originalExibirCaptcha !== undefined,
      };
    });
    console.log('Mock status:', JSON.stringify(mockStatus));

    // ============================================================
    // Preencher formulario
    // ============================================================
    console.log('\n[3] Preenchendo OAB: ' + OAB);

    await page.click('input[name="codigoOAB"]', { clickCount: 3 });
    await page.keyboard.type(OAB);

    await page.evaluate(() => {
      const s = document.querySelector('select[name="tipoOAB"]');
      if (s) for (const opt of s.options) if (opt.value === 'N') { opt.selected = true; break; }
      const u = document.querySelector('select[name="ufOAB"]');
      if (u) for (const opt of u.options) if (opt.value === 'MG') { opt.selected = true; break; }
      const a = document.querySelector('select[name="ativoBaixado"]');
      if (a) for (const opt of a.options) if (opt.value === 'X') { opt.selected = true; break; }
      const n = document.querySelector('select[name="natureza"]');
      if (n) for (const opt of n.options) if (opt.value === '0') opt.selected = true;
    });

    console.log('Formulario preenchido');

    // ============================================================
    // Submit
    // ============================================================
    console.log('\n[4] Clicando Pesquisar...');

    const btn = await page.$('input[type="submit"]');
    if (btn) {
      await btn.click();
      console.log('Clicado!');
    }

    await new Promise(r => setTimeout(r, 10000));

    // ============================================================
    // Ver resultado
    // ============================================================
    console.log('\n[5] URL: ' + page.url());

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
      return {
        total,
        count: unique.length,
        processos: unique.slice(0, 10),
        snippet: text.substring(0, 2000),
      };
    });

    console.log('\n=== RESULTADO ===');
    console.log('Total: ' + resultado.total);
    console.log('Processos: ' + resultado.count);

    if (resultado.count > 0) {
      console.log('\nProcessos:');
      resultado.processos.forEach((p, i) => console.log('  ' + (i+1) + '. ' + p));
    } else {
      console.log('\nSnippet:\n' + resultado.snippet);
    }

  } catch (error) {
    console.error('ERRO:', error.message);
  } finally {
    await browser.close();
  }

  console.log('\n============================================================');
}

main().catch(console.error);
