const { sequelize } = require('./dist/models');
async function main() {
  await sequelize.authenticate();
  const [results] = await sequelize.query("SELECT id, oab, nome, email FROM advogados WHERE oab = 'SP999999'");
  console.log(JSON.stringify(results, null, 2));
  await sequelize.close();
}
main().catch(console.error);
