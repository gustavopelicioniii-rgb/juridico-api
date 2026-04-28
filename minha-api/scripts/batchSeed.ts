/**
 * Batch Seed Script - Seeds 50 test advogados with OAB numbers
 */

import { connectDatabase, sequelize } from '../src/config/database';
import Advogado from '../src/models/Advogado';

const NOMES = [
  'João Silva', 'Maria Santos', 'Pedro Oliveira', 'Ana Costa', 'Carlos Ferreira',
  'Juliana Almeida', 'Lucas Rodrigues', 'Camila Pereira', 'Rafael Lima', 'Larissa Gomes',
  'Bruno Martins', 'Beatriz Rocha', 'Felipe Souza', 'Carolina Castro', 'Gustavo Barbosa',
  'Amanda Melo', 'Thiago Ribeiro', 'Bianca Cardoso', 'Daniel Correia', 'Vanessa Alves',
  'Marcos Pinto', 'Aline Dumas', 'Leandro Farias', 'Priscila Ramos', 'Renato Machado',
  'Sabrina Vieira', 'Hugo Leonard', 'Adriana Moura', 'Sérgio Coutinho', 'Patrícia Andrade',
  'Marcelo Dantas', 'Renata Bittencourt', 'Fábio Nunes', 'Daniela Lemos', 'William Salgado',
  'Luciana Parente', 'Roberto Gurgel', 'Fernanda Lima', 'Alexandre Mendes', 'Juliane Pimenta',
  'Eduardo Sousa', 'Cristina Lima', 'Roberto Carlos', 'Ana Paula Souza', 'Paulo Henrique',
  'Rita Cassiano', 'Sandro Luiz', 'Carla Natasha', 'Marcio Rodrigues', 'Adriana Pereira'
];

async function batchSeedAdvogados() {
  console.log('🌱 Starting batch OAB seed...\n');
  
  await connectDatabase();
  
  let created = 0;
  let skipped = 0;
  
  for (let i = 1; i <= 50; i++) {
    const oab = `SP${String(i).padStart(6, '0')}`;
    const nome = `${NOMES[i % NOMES.length]} ${i}`;
    const email = `advogado${i}@teste.com`;
    
    try {
      const [advogado, isNew] = await Advogado.findOrCreate({
        where: { oab },
        defaults: {
          nome,
          oab,
          email,
          ativo: true,
        },
      });
      
      if (isNew) {
        created++;
        console.log(`  ✅ Created: ${oab} - ${nome}`);
      } else {
        skipped++;
        console.log(`  ⏭️  Skipped (exists): ${oab}`);
      }
    } catch (error) {
      console.log(`  ❌ Error with ${oab}: ${error}`);
    }
  }
  
  console.log(`\n📊 Summary:`);
  console.log(`   Created: ${created} new advogados`);
  console.log(`   Skipped: ${skipped} existing`);
  console.log(`   Total in DB: ${await Advogado.count()}`);
  
  await sequelize.close();
  console.log('\n✨ Batch seed complete!');
}

batchSeedAdvogados().catch((error) => {
  console.error('❌ Batch seed failed:', error);
  process.exit(1);
});
