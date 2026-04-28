/* eslint-disable */
import puppeteer from 'puppeteer';

async function main() {
  const OAB = '104819';

  console.log('='.repeat(60));
  console.log(`TESTE TJMG COM PUPPETEER - OAB ${OAB}`);
  console.log('='.repeat(60));

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

    // 1. Acessar formulário
    console.log('\n[1] Acessando formulario TJMG...');
    await page.goto('https://www4.tjmg.jus.br/juridico/sf/index_oab.jsp', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    console.log('Pagina carregada');

    await new Promise(r => setTimeout(r, 2000));

    // 2. Verificar CAPTCHA
    const captchaCheck: any = await page.evaluate(() => {
      const doc = document as any;
      const bodyText = doc.body.innerText.toLowerCase();
      return {
        hasCaptchaImg: doc.querySelector('img[src*="captcha"]') !== null,
        hasRecaptcha: doc.querySelector('.g-recaptcha') !== null,
        hasCaptchaText: bodyText.includes('captcha'),
        bodySnippet: doc.body.innerText.substring(0, 500),
      };
    });

    console.log('CAPTCHA check:', JSON.stringify(captchaCheck, null, 2));

    // 3. Preencher OAB
    console.log('\n[2] Preenchendo campo OAB...');

    const filled: any = await page.evaluate((oabNum: string) => {
      const doc = document as any;
      const selectors = [
        'input[name="codigoOAB"]',
        'input[id="codigoOAB"]',
        'input[name*="codigoOAB"]',
        'input[id*="codigoOAB"]',
        'input[placeholder*="OAB"]',
        'input[name="numeroOAB"]',
      ];

      for (const sel of selectors) {
        const input = doc.querySelector(sel);
        if (input) {
          input.focus();
          input.value = '';
          for (const char of oabNum) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            setter?.call(input, input.value + char);
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
          return sel;
        }
      }
      return null;
    }, OAB);

    console.log(`Campo OAB preenchido (seletor: ${filled})`);

    // 4. Selecionar opções
    await page.evaluate(() => {
      const doc = document as any;
      const natSelect = doc.querySelector('select[name="natureza"]');
      if (natSelect) {
        const opts = natSelect.querySelectorAll('option');
        for (const opt of opts) {
          if (opt.value === '0' || opt.value === '') { opt.selected = true; break; }
        }
      }
      const ativoSelect = doc.querySelector('select[name="ativoBaixado"]');
      if (ativoSelect) {
        const opts = ativoSelect.querySelectorAll('option');
        for (const opt of opts) {
          if (opt.value === 'X') { opt.selected = true; break; }
        }
      }
    });

    await new Promise(r => setTimeout(r, 500));

    // 5. Clicar Pesquisar
    console.log('\n[3] Clicando em Pesquisar...');

    const clicked: any = await page.evaluate(() => {
      const doc = document as any;
      const allBtns = doc.querySelectorAll('button, input[type="submit"], input[type="button"]');
      for (const btn of allBtns) {
        const txt = btn.textContent?.toLowerCase() || btn.value?.toLowerCase() || '';
        if (txt.includes('pesquisar') || txt.includes('buscar')) {
          btn.click();
          return txt;
        }
      }
      return null;
    });

    console.log(`Botao clicado: ${clicked}`);

    // 6. Aguardar resultado
    console.log('\n[4] Aguardando resultado...');
    await new Promise(r => setTimeout(r, 5000));

    // 7. Verificar resultado
    const resultado: any = await page.evaluate(() => {
      const doc = document as any;
      const bodyText = doc.body.innerText;
      const processosMatch = bodyText.match(/Processos encontrados[:\s]*(\d+)/i);
      const total = processosMatch ? parseInt(processosMatch[1]) : 0;
      const processos = bodyText.match(/\d{7}[\d\-\.]+/g) || [];
      const hasCaptcha = bodyText.toLowerCase().includes('captcha');

      return {
        total,
        processosEncontrados: processos.length,
        sampleProcessos: processos.slice(0, 5),
        hasCaptcha,
        url: window.location.href,
      };
    });

    console.log('\n--- RESULTADO ---');
    console.log(`Total de processos: ${resultado.total}`);
    console.log(`Processos no HTML: ${resultado.processosEncontrados}`);
    console.log(`Tem CAPTCHA: ${resultado.hasCaptcha}`);
    console.log(`URL: ${resultado.url}`);

    if (resultado.sampleProcessos.length > 0) {
      console.log('\nPrimeiros processos:');
      resultado.sampleProcessos.forEach((p: string, i: number) => {
        console.log(`  ${i + 1}. ${p}`);
      });
    }

  } catch (error: any) {
    console.error('\nERRO:', error.message);
  } finally {
    await browser.close();
  }

  console.log('\n' + '='.repeat(60));
}

main().catch(console.error);
