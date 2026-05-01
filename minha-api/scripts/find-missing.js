const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/database.sqlite');

async function main() {
  // Get all OAB cache entries
  const cacheEntries = await new Promise((resolve, reject) => {
    db.all("SELECT oab, tribunal_codigo, resultado_json, total_processos FROM oab_busca_cache", (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  console.log('Cache entries:');
  cacheEntries.forEach(row => {
    const nums = JSON.parse(row.resultado_json).numerosProcessos;
    console.log(`  OAB: ${row.oab}, Tribunal: ${row.tribunal_codigo}, Total: ${row.total_processos}, No Cache: ${nums.length}`);
  });

  // Get all unique process numbers with 361329 from database
  const dbProcessos = await new Promise((resolve, reject) => {
    db.all("SELECT numero_processo FROM processos WHERE numero_processo LIKE '%361329%'", (err, rows) => {
      if (err) reject(err);
      else resolve(rows.map(r => r.numero_processo));
    });
  });

  console.log('\nTotal unique processos in DB:', dbProcessos.length);

  db.close();
}

main().catch(console.error);
