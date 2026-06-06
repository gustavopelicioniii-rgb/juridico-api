import { sequelize } from '../src/models';
import Tribunal from '../src/models/Tribunal';
import { listarTribunaisDataJud } from '../src/config/datajudTribunais';
import { ensureAdminSeed } from '../src/services/AdminSeedService';

const seedTribunais = async (): Promise<void> => {
  const tribunaisData = listarTribunaisDataJud();

  for (const data of tribunaisData) {
    const [tribunal, created] = await Tribunal.findOrCreate({
      where: { codigo: data.codigo },
      defaults: data,
    });
    if (!created) {
      await tribunal.update(data);
    }
    console.log(`${created ? '✅ Created' : '📝 Updated'}: ${tribunal.nome}`);
  }
};

const seedSampleAdvogado = async (): Promise<void> => {
  const result = await ensureAdminSeed({
    oab: process.env.ADMIN_OAB,
    password: process.env.ADMIN_PASSWORD,
    nome: process.env.ADMIN_NOME,
    email: process.env.ADMIN_EMAIL,
  });

  if (result.skipped) {
    console.log('⏭️  Admin seed skipped (set ADMIN_OAB and ADMIN_PASSWORD to create)');
    return;
  }

  const advogado = result.advogado!;
  console.log(`${result.created ? '✅ Created' : '📝 Found'}: Advogado ${advogado.nome} (${advogado.oab})`);
};

const main = async (): Promise<void> => {
  try {
    console.log('🚀 Starting database seed...\n');
    
    await sequelize.authenticate();
    console.log('✅ Database connected\n');
    
    await seedTribunais();
    console.log('');
    
    await seedSampleAdvogado();
    
    console.log('\n✅ Seed completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  }
};

main();
