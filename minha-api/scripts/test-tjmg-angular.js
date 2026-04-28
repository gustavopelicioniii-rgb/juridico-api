const puppeteer = require('puppeteer');

async function main() {
  const OAB = '104819';

  console.log('============================================================');
  console.log('TESTE TJMG - FORCAR ANGULAR DIGEST');
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

    console.log('\n[1] Carregando pagina OAB...');

    await page.goto(
      'https://www4.tjmg.jus.br/juridico/sf/proc_oab.jsp?comrCodigo=24&cbo_nome_comarca=24&numero=1',
      { waitUntil: 'networkidle2', timeout: 30000 }
    );
    await new Promise(r => setTimeout(r, 2000));

    // Verificar se usa AngularJS
    const hasAngular = await page.evaluate(() => {
      return !!(window.angular || document.querySelector('[ng-app]') || document.querySelector('.ng-scope'));
    });
    console.log('AngularJS detectado: ' + (hasAngular ? 'SIM' : 'NAO'));

    // Verificar jQuery também
    const hasJQuery = await page.evaluate(() => {
      return !!(window.jQuery || window.$);
    });
    console.log('jQuery detectado: ' + (hasJQuery ? 'SIM' : 'NAO'));

    // ============================================================
    // Preencher usando page.type() - simula teclado real
    // ============================================================
    console.log('\n[2] Preenchendo OAB via page.type()...');

    // Clicar no campo OAB primeiro
    await page.click('input[name="codigoOAB"]');
    await new Promise(r => setTimeout(r, 500));

    // Selecionar todo o texto e substituir
    await page.keyboard.press('Control+A');
    await new Promise(r => setTimeout(r, 200));

    // Digitar OAB
    await page.keyboard.type(OAB);
    console.log('OAB digitada via keyboard!');

    await new Promise(r => setTimeout(r, 500));

    // Verificar valor no DOM
    const domValue = await page.$eval('input[name="codigoOAB"]', el => el.value);
    console.log('Valor no DOM: ' + domValue);

    // Forcar Angular digest se existir
    await page.evaluate(() => {
      // Tentar encontrar e executar Angular bootstrap
      const el = document.querySelector('[ng-app]') || document.querySelector('[data-ng-app]');
      if (el && window.angular) {
        const injector = angular.element(el).injector();
        if (injector) {
          const scope = angular.element(el).scope();
          if (scope) {
            scope.$apply();
            console.log('[ANGULAR] Digest forçado');
          }
        }
      }

      // Tentar também jQuery trigger
      if (window.jQuery) {
        jQuery('input[name="codigoOAB"]').trigger('input');
        jQuery('input[name="codigoOAB"]').trigger('change');
        console.log('[JQ] Events triggered');
      }
    });

    await new Promise(r => setTimeout(r, 500));

    // Selecionar opcoes
    console.log('\n[3] Selecionando opcoes...');
    await page.evaluate(() => {
      // tipoOAB = N
      const tipo = document.querySelector('select[name="tipoOAB"]');
      if (tipo) tipo.value = 'N';
      // ufOAB = MG
      const uf = document.querySelector('select[name="ufOAB"]');
      if (uf) uf.value = 'MG';
      // ativoBaixado = X
      const ativo = document.querySelector('select[name="ativoBaixado"]');
      if (ativo) ativo.value = 'X';
      // natureza = 0
      const nat = document.querySelector('select[name="natureza"]');
      if (nat) nat.value = '0';
    });

    await new Promise(r => setTimeout(r, 500));

    // Verificar valor final do campo OAB
    const finalValue = await page.$eval('input[name="codigoOAB"]', el => el.value);
    console.log('Valor final OAB no DOM: ' + finalValue);

    // ============================================================
    // Submit - tentar via Enter primeiro
    // ============================================================
    console.log('\n[4] Submetendo via Enter...');
    await page.focus('input[name="codigoOAB"]');
    await page.keyboard.press('Enter');

    await new Promise(r => setTimeout(r, 8000));
    console.log('URL: ' + page.url());

    let resultado = await page.evaluate(() => {
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

    console.log('Total: ' + resultado.total + ' | Processos: ' + resultado.count);

    if (resultado.count === 0) {
      // Tentar click no botao
      console.log('\n[5] Tentando click no botao...');
      await page.click('input[type="submit"]');
      await new Promise(r => setTimeout(r, 8000));
      console.log('URL: ' + page.url());

      resultado = await page.evaluate(() => {
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

      console.log('Total: ' + resultado.total + ' | Processos: ' + resultado.count);
    }

    console.log('\n=== RESULTADO FINAL ===');
    if (resultado.count > 0) {
      console.log('SUCESSO! ' + resultado.count + ' processos encontrados');
      resultado.processos.forEach((p, i) => console.log('  ' + (i+1) + '. ' + p));
    } else {
      console.log('Nenhum processo encontrado');
      const snippet = await page.evaluate(() => document.body.innerText.substring(0, 1500));
      console.log(snippet);
    }

  } catch (error) {
    console.error('ERRO:', error.message);
  } finally {
    await browser.close();
  }

  console.log('\n============================================================');
}

main().catch(console.error);
