const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/database.sqlite');

async function main() {
  // Count total monitoramentos
  const total = await new Promise((resolve, reject) => {
    db.get("SELECT COUNT(*) as count FROM monitoramentos", (err, row) => {
      if (err) reject(err);
      else resolve(row.count);
    });
  });

  // Count active monitoramentos
  const ativos = await new Promise((resolve, reject) => {
    db.get("SELECT COUNT(*) as count FROM monitoramentos WHERE ativo = 1", (err, row) => {
      if (err) reject(err);
      else resolve(row.count);
    });
  });

  // Get monitoramentos with processo info
  const monitoramentos = await new Promise((resolve, reject) => {
    db.all(`
      SELECT m.id, m.advogado_id, m.processo_id, m.intervalo_minutos, m.ativo, m.ultimo_poll,
             p.numero_processo
      FROM monitoramentos m
      JOIN processos p ON m.processo_id = p.id
      WHERE m.ativo = 1
      LIMIT 10
    `, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  console.log('Total monitoramentos:', total);
  console.log('Monitoramentos ativos:', ativos);
  console.log('\nPrimeiros 10 monitoramentos ativos:');
  monitoramentos.forEach(m => {
    console.log(`  - Processo: ${m.numero_processo}, Intervalo: ${m.intervalo_minutos}min, Último poll: ${m.ultimo_poll}`);
  });

  // Check if there are OABs being monitored
  const oabsMonitoradas = await new Promise((resolve, reject) => {
    db.all("SELECT * FROM oabs_monitoradas LIMIT 10", (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  console.log('\nOABs monitoradas:', oabsMonitoradas.length);

  db.close();
}

main().catch(console.error);
