const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/database.sqlite');

db.all("SELECT COUNT(*) as count FROM processos WHERE numero_processo LIKE '%361329%'", (err, rows) => {
  if (err) {
    console.error('Error:', err);
  } else {
    console.log('Processos com 361329 no número:', rows[0].count);
  }
  db.close();
});
