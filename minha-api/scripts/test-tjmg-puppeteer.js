const puppeteer = require('puppeteer');

async function main() {
  const OAB = '104819';

  console.log('='.repeat(60));
  console.log('TESTE TJMG COM PUPPETEER - OAB ' + OAB);
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

    console.log('\n[1] Acessando formulario TJMG...');
    await page.goto('https://www4.tjmg.jus.br/juridico/sf/index_oab.jsp', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    console.log('Pagina carregada');
    await new Promise(r => setTimeout(r, 2000));

    const hasCaptcha = await page.evaluate(() => {
      return document.body.innerText.toLowerCase().includes('captcha');
    });
    console.log('Tem CAPTCHA: ' + (hasCaptcha ? 'SIM' : 'NAO - BINGO!'));

    // 1. Selecionar comarca BH (codigo 7 - Belo Horizonte)
    console.log('\n[2] Selecionando comarca BH...');
    // O valor 2 que vimos corresponde a Abaete. BH deve ser outro codigo.
    // Vamos verificar a lista de comarcas
    const comarcas = await page.evaluate(() => {
      const select = document.querySelector('#cbo_nome_comarca');
      if (!select) return [];
      return Array.from(select.options).map(o => ({ value: o.value, text: o.text })).slice(1, 10);
    });
    console.log('Comarcas disponiveis:', JSON.stringify(comarcas));

    // Selecionar BH (normalmente codigo 7 ou proximo)
    const bhOption = comarcas.find(c => c.text.includes('Belo Horizonte'));
    const bhCode = bhOption ? bhOption.value : '7';
    console.log('Selecionando BH: ' + bhCode + ' - ' + (bhOption ? bhOption.text : 'default'));
    await page.select('#cbo_nome_comarca', bhCode);

    // Aguardar campos dinâmicos aparecerem
    console.log('Aguardando campos dinâmicos...');
    await new Promise(r => setTimeout(r, 2000));

    // 2. Agora o campo OAB deve existir - preencher
    console.log('\n[3] Preenchendo OAB...');

    // O campo OAB pode ter name diferente. Vamos descobrir
    const oabSelectors = [
      'input[name="codigoOAB"]',
      'input[id="codigoOAB"]',
      'input[name="nuOABAdvogado"]',
      'input[id="nuOABAdvogado"]',
      'input[name="numeroOAB"]',
      'input[id="numeroOAB"]',
      'input[name="oabNumero"]',
      'input[name*="OAB"]',
      'input[id*="nuOAB"]',
      'input[placeholder*="OAB"]',
    ];

    let oabField = null;
    for (const sel of oabSelectors) {
      const el = await page.$(sel);
      if (el) {
        const tagName = await el.evaluate(e => e.tagName);
        const name = await el.evaluate(e => e.name);
        const id = await el.evaluate(e => e.id);
        const placeholder = await el.evaluate(e => e.placeholder);
        console.log('Encontrado: ' + sel + ' (name=' + name + ', id=' + id + ')');
        oabField = sel;
        break;
      }
    }

    if (oabField) {
      // Limpar e preencher
      await page.click(oabField, { clickCount: 3 });
      await page.keyboard.type(OAB);
      console.log('OAB preenchida!');
    } else {
      // Dump all inputs para debug
      const allInputs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('input')).map(i => ({
          name: i.name, id: i.id, type: i.type, placeholder: i.placeholder
        }));
      });
      console.log('Campo OAB NAO encontrado. Inputs visiveis:', JSON.stringify(allInputs));
    }

    // 3. Selecionar tipo OAB = N
    console.log('\n[4] Selecionando tipo OAB...');
    const tipoOAB = await page.$('select[name="tipoOAB"]');
    if (tipoOAB) {
      await tipoOAB.evaluate(el => {
        for (const opt of el.options) {
          if (opt.value === 'N') { opt.selected = true; break; }
        }
      });
      console.log('Tipo OAB=N selecionado');
    }

    // 4. Selecionar situacao = Ativos e Baixados (X)
    await page.evaluate(() => {
      const ativoSelect = document.querySelector('select[name="ativoBaixado"]');
      if (ativoSelect) {
        for (const opt of ativoSelect.options) {
          if (opt.value === 'X') { opt.selected = true; break; }
        }
      }
    });

    // 5. Selecionar natureza = Civel/Criminal
    await page.evaluate(() => {
      const natSelect = document.querySelector('select[name="natureza"]');
      if (natSelect) {
        for (const opt of natSelect.options) {
          if (opt.value === '0') { opt.selected = true; break; }
        }
      }
    });

    await new Promise(r => setTimeout(r, 500));

    // 6. Clicar Pesquisar
    console.log('\n[5] Clicando em Pesquisar...');
    const submitBtn = await page.$('input[type="submit"]');
    if (submitBtn) {
      await submitBtn.click();
      console.log('Botao clicado');
    }

    // 7. Aguardar resultado
    console.log('\n[6] Aguardando resultado (8s)...');
    await new Promise(r => setTimeout(r, 8000));

    const url = page.url();
    console.log('URL: ' + url);

    const resultado = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      const processosMatch = bodyText.match(/Processos encontrados[:\s]*(\d+)/i);
      const total = processosMatch ? parseInt(processosMatch[1]) : 0;
      const processos = bodyText.match(/\d{7}[\d\-\.]+/g) || [];
      const unique = [...new Set(processos)];
      const hasCaptcha = bodyText.toLowerCase().includes('captcha');
      const semResultado = bodyText.toLowerCase().includes('nenhum processo') ||
                          bodyText.toLowerCase().includes('sem resultado');

      return {
        total,
        uniqueCount: unique.length,
        samples: unique.slice(0, 5),
        hasCaptcha,
        semResultado,
        snippet: bodyText.substring(0, 2000),
      };
    });

    console.log('\n--- RESULTADO ---');
    console.log('Total registrado: ' + resultado.total);
    console.log('Processos unicos: ' + resultado.uniqueCount);
    console.log('Tem CAPTCHA: ' + resultado.hasCaptcha);
    console.log('Sem resultado: ' + resultado.semResultado);

    if (resultado.samples.length > 0) {
      console.log('\nProcessos encontrados:');
      resultado.samples.forEach((p, i) => console.log('  ' + (i+1) + '. ' + p));
    } else {
      console.log('\nSnippet:\n' + resultado.snippet);
    }

  } catch (error) {
    console.error('\nERRO:', error.message);
  } finally {
    await browser.close();
  }

  console.log('\n' + '='.repeat(60));
}

main().catch(console.error);
