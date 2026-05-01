const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/database.sqlite');

async function main() {
  const oabs = await new Promise((resolve, reject) => {
    db.all("SELECT * FROM oabs_monitoradas", (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  console.log('OABs monitoradas:');
  oabs.forEach(oab => {
    console.log(`  - OAB: ${oab.oab}, Tribunal: ${oab.tribunal_codigo}, Última busca: ${oab.ultima_busca}, Ativo: ${oab.ativo}`);
  });

  db.close();
}

main().catch(console.error);
