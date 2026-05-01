const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/database.sqlite');

async function main() {
  // Get table schema
  const schema = await new Promise((resolve, reject) => {
    db.all("PRAGMA table_info(oabs_monitoradas)", (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  console.log('Schema da tabela oabs_monitoradas:');
  schema.forEach(col => {
    console.log(`  - ${col.name}: ${col.type}, nullable: ${col.notnull === 0}, default: ${col.dflt_value}`);
  });

  // Get all data
  const data = await new Promise((resolve, reject) => {
    db.all("SELECT * FROM oabs_monitoradas", (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  console.log('\nDados completos:');
  console.log(JSON.stringify(data, null, 2));

  db.close();
}

main().catch(console.error);
