import { sequelize } from '../config/database';
import Advogado from './Advogado';
import Tribunal from './Tribunal';
import Processo from './Processo';
import Parte from './Parte';
import Movimentacao from './Movimentacao';
import Job from './Job';
import Monitoramento from './Monitoramento';

// Define Associations
Advogado.hasMany(Processo, { foreignKey: 'advogadoId', as: 'processos' });
Processo.belongsTo(Advogado, { foreignKey: 'advogadoId', as: 'advogado' });

Tribunal.hasMany(Processo, { foreignKey: 'tribunalId', as: 'processos' });
Processo.belongsTo(Tribunal, { foreignKey: 'tribunalId', as: 'tribunal' });

Processo.hasMany(Parte, { foreignKey: 'processoId', as: 'partes' });
Parte.belongsTo(Processo, { foreignKey: 'processoId', as: 'processo' });

Processo.hasMany(Movimentacao, { foreignKey: 'processoId', as: 'movimentacoes' });
Movimentacao.belongsTo(Processo, { foreignKey: 'processoId', as: 'processo' });

Processo.hasMany(Job, { foreignKey: 'processoId', as: 'jobs' });
Job.belongsTo(Processo, { foreignKey: 'processoId', as: 'processo' });

Processo.hasMany(Monitoramento, { foreignKey: 'processoId', as: 'monitoramentos' });
Monitoramento.belongsTo(Processo, { foreignKey: 'processoId', as: 'processo' });

Advogado.hasMany(Monitoramento, { foreignKey: 'advogadoId', as: 'monitoramentos' });
Monitoramento.belongsTo(Advogado, { foreignKey: 'advogadoId', as: 'advogado' });

export {
  sequelize,
  Advogado,
  Tribunal,
  Processo,
  Parte,
  Movimentacao,
  Job,
  Monitoramento,
};

export default {
  Advogado,
  Tribunal,
  Processo,
  Parte,
  Movimentacao,
  Job,
  Monitoramento,
};
