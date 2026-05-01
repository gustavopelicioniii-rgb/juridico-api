import { sequelize } from './src/config/database';
import Processo from './src/models/Processo';
import { Op } from 'sequelize';

async function count() {
  try {
    await sequelize.authenticate();
    console.log('Database connected');

    const total = await Processo.count();
    console.log('Total de processos no banco:', total);

    const with361329 = await Processo.count({
      where: {
        numeroProcesso: { [Op.like]: '%361329%' }
      }
    });
    console.log('Com 361329 no número:', with361329);

    // Mostrar alguns números
    const processos = await Processo.findAll({
      where: { numeroProcesso: { [Op.like]: '%361329%' } },
      attributes: ['numeroProcesso'],
      limit: 10
    });
    console.log('\nPrimeiros 10 processos:');
    processos.forEach((p: any) => console.log(' ', p.numeroProcesso));

    await sequelize.close();
  } catch (error) {
    console.error('Error:', error);
  }
}

count();
