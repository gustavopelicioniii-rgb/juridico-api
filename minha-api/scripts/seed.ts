import { sequelize } from '../src/models';
import Tribunal from '../src/models/Tribunal';
import Advogado from '../src/models/Advogado';
import bcrypt from 'bcryptjs';

const seedTribunais = async (): Promise<void> => {
  const tribunaisData = [
    {
      codigo: 'TJSP',
      nome: 'Tribunal de Justiça de São Paulo',
      baseUrl: 'https://api.tjsp.jus.br',
      tipo: 'TJ' as const,
      usaCaptcha: false,
      scraperConfig: { endpoint: '/v2/processos' },
    },
    {
      codigo: 'TJMG',
      nome: 'Tribunal de Justiça de Minas Gerais',
      baseUrl: 'https://www.tjmg.jus.br',
      tipo: 'TJ' as const,
      usaCaptcha: true,
      scraperConfig: { portal: 'cpov' },
    },
    {
      codigo: 'STJ',
      nome: 'Superior Tribunal de Justiça',
      baseUrl: 'https://www.stj.jus.br',
      tipo: 'STJ' as const,
      usaCaptcha: false,
      scraperConfig: { caminho: '/consultas/processo' },
    },
    {
      codigo: 'STF',
      nome: 'Supremo Tribunal Federal',
      baseUrl: 'https://portal.stf.jus.br',
      tipo: 'STF' as const,
      usaCaptcha: false,
      scraperConfig: { caminho: '/processos' },
    },
    {
      codigo: 'TST',
      nome: 'Tribunal Superior do Trabalho',
      baseUrl: 'https://www.tst.jus.br',
      tipo: 'TRT' as const,
      usaCaptcha: false,
      scraperConfig: { caminho: '/consultas' },
    },
  ];

  for (const data of tribunaisData) {
    const [tribunal, created] = await Tribunal.findOrCreate({
      where: { codigo: data.codigo },
      defaults: data,
    });
    console.log(`${created ? '✅ Created' : '📝 Found'}: ${tribunal.nome}`);
  }
};

const seedSampleAdvogado = async (): Promise<void> => {
  const senhaHash = await bcrypt.hash('juridico123', 12);
  const [advogado, created] = await Advogado.findOrCreate({
    where: { oab: 'SP123456' },
    defaults: {
      oab: 'SP123456',
      nome: 'João Silva',
      email: 'joao.silva@exemplo.com',
      ativo: true,
      passwordHash: senhaHash,
    },
  });
  console.log(`${created ? '✅ Created' : '📝 Found'}: Advogado ${advogado.nome}`);
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
