const { sequelize } = require('./src/models');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

async function main() {
  await sequelize.authenticate();
  const hash = await bcrypt.hash('admin123', 12);
  const id = crypto.randomUUID();
  await sequelize.query(
    `INSERT INTO advogados (id, oab, nome, email, password_hash, ativo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    { replacements: [id, 'SP999999', 'Admin Sistema', 'admin@juridico.com', hash, 1] }
  );
  console.log('Admin criado: SP999999 / admin123');
  await sequelize.close();
}
main().catch(console.error);
