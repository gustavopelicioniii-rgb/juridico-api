const puppeteer = require('puppeteer');

async function main() {
  const OAB = '104819';

  console.log('============================================================');
  console.log('TESTE TJMG - COMARCA 97 (Abaete)');
  console.log('============================================================');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--disable-gpu', '--window-size=1920x1080'],
  });

  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');

    // URL com comarca 97 (Abaete) - onde OAB 104819 tem processos
    const params = new URLSearchParams({
      ativoBaixado: 'X',
      codigoOAB: OAB,
      comrCodigo: '97', // Abaete
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

    const url = `https://www4.tjmg.jus.br/juridico/sf/proc_resultado_oab.jsp?${params.toString()}`;

    console.log('\n[1] Navegando para comarca 97 (Abaete)...');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    const hasCaptcha = await page.evaluate(() => document.body.innerText.toLowerCase().includes('captcha'));
    console.log('CAPTCHA: ' + (hasCaptcha ? 'SIM' : 'NAO'));

    const resultado = await page.evaluate(() => {
      const text = document.body.innerText;
      const totalMatch = text.match(/Processos encontrados[:\s]*(\d+)/i);
      const total = totalMatch ? parseInt(totalMatch[1]) : 0;
      const linhas = text.match(/PROCESSO\s*:\s*[\d\-\.]+/gi) || [];
      const seen = new Set();
      const processos = [];

      linhas.forEach(linha => {
        const numMatch = linha.match(/PROCESSO\s*:\s*([\d\-\.]+)/i);
        const classeMatch = linha.match(/Classe:\s*([^\n]+)/i);
        const distMatch = linha.match(/Distribui[cc][aa]o:\s*([^\n]+)/i);
        const movMatch = linha.match(/ltima Movimenta[cc][aa]o:\s*([^\n]+)/i);

        if (numMatch) {
          const num = numMatch[1].replace(/\D/g, '');
          if (!seen.has(num) && num.length >= 7) {
            seen.add(num);
            processos.push({
              numero: num,
              classe: classeMatch ? classeMatch[1].trim().substring(0, 50) : '',
              distribuicao: distMatch ? distMatch[1].trim() : '',
              ultimaMov: movMatch ? movMatch[1].trim() : '',
              situacao: linha.includes('BAIXADO') ? 'BAIXADO' : 'ATIVO',
            });
          }
        }
      });

      return { total, count: processos.length, processos: processos.slice(0, 20) };
    });

    console.log('\n=== RESULTADO ===');
    console.log('Total: ' + resultado.total + ' | Extraidos: ' + resultado.count);

    if (resultado.count > 0) {
      console.log('\n*** SUCESSO! Processos:');
      resultado.processos.forEach((p, i) => {
        console.log((i+1) + '. ' + p.numero + ' | ' + p.classe + ' | ' + p.situacao);
      });
    }

    console.log('\n============================================================');
    console.log('RESUMO: OAB ' + OAB + ' tem ' + resultado.total + ' processos em Abaete');
    console.log('============================================================');

  } catch (error) {
    console.error('ERRO:', error.message);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
