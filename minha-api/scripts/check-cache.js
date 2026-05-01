const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/database.sqlite');

db.all("SELECT resultado_json FROM oab_busca_cache WHERE oab = '361329SP'", (err, rows) => {
  if (err) {
    console.error('Error:', err);
    db.close();
    return;
  }
  if (rows.length > 0) {
    const data = JSON.parse(rows[0].resultado_json);
    console.log('Números de processos no cache:', data.numerosProcessos.length);
    console.log('Primeiros 10:', data.numerosProcessos.slice(0, 10));
  } else {
    console.log('Cache não encontrado');
  }
  db.close();
});
