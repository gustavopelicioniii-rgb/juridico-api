import bcrypt from 'bcryptjs';
import { sequelize } from '../src/models';
import Advogado from '../src/models/Advogado';

async function main() {
  await sequelize.authenticate();
  console.log('✅ DB connected');

  const oab = 'MG123456';
  const nome = 'Desenvolvedor';
  const email = 'dev@juridico.com';
  const senha = 'dev12345';

  const existing = await Advogado.findOne({ where: { oab } });

  if (existing) {
    const hash = await bcrypt.hash(senha, 12);
    existing.passwordHash = hash;
    existing.nome = nome;
    existing.email = email;
    existing.ativo = true;
    await existing.save();
    console.log(`✅ Updated existing user: ${oab}`);
  } else {
    const hash = await bcrypt.hash(senha, 12);
    await Advogado.create({ oab, nome, email, passwordHash: hash, ativo: true });
    console.log(`✅ Created new user: ${oab}`);
  }

  // Test login
  const user = await Advogado.findOne({ where: { oab } });
  const valid = await bcrypt.compare(senha, user!.passwordHash!);
  console.log(`🔐 Password test: ${valid ? 'OK' : 'FAILED'}`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
