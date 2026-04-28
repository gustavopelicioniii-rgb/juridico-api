const puppeteer = require('puppeteer');

async function main() {
  const OAB = '104819';

  console.log('============================================================');
  console.log('TESTE TJMG - USA JQUERY (window.$)');
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

    // Verificar libs
    const libs = await page.evaluate(() => {
      const result = {
        hasWindowJQuery: 'jQuery' in window,
        hasWindowDollar: '$' in window,
      };
      if (window.jQuery) result.jqVer = window.jQuery.fn.jquery;
      if (window.$ && window.$.fn) result.$ver = window.$.fn.jquery;
      return result;
    });
    console.log('Libs:', JSON.stringify(libs));

    // Preencher via jQuery
    const fillResult = await page.evaluate((oab) => {
      try {
        const jq = window.jQuery || window.$;
        if (!jq) return { erro: 'jQuery nao disponivel' };

        const $ = jq;

        // Preencher OAB
        const $oab = $('input[name="codigoOAB"]');
        if ($oab.length) {
          $oab.val(oab).trigger('input').trigger('change');
        }

        // Selecionar opcoes
        $('select[name="tipoOAB"]').val('N').trigger('change');
        $('select[name="ufOAB"]').val('MG').trigger('change');
        $('select[name="ativoBaixado"]').val('X').trigger('change');
        $('select[name="natureza"]').val('0').trigger('change');

        return {
          oabValue: $oab.val(),
          tipoValue: $('select[name="tipoOAB"]').val(),
        };
      } catch (e) {
        return { erro: e.message };
      }
    }, OAB);

    console.log('Fill result:', JSON.stringify(fillResult));

    await new Promise(r => setTimeout(r, 1000));

    // Submit
    console.log('\n[2] Clicando submit...');
    await page.click('input[type="submit"]');
    await new Promise(r => setTimeout(r, 10000));

    console.log('URL: ' + page.url());

    // Resultado
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
      console.log('\nSUCESSO! Processos:');
      resultado.processos.forEach((p, i) => console.log('  ' + (i+1) + '. ' + p));
    } else {
      const snippet = await page.evaluate(() => document.body.innerText.substring(0, 1500));
      console.log('\nSnippet:\n' + snippet);
    }

  } catch (error) {
    console.error('ERRO:', error.message);
  } finally {
    await browser.close();
  }

  console.log('\n============================================================');
}

main().catch(console.error);
