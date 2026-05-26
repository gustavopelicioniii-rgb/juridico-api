import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { DEFAULT_PROCESS_MONITORING_INTERVAL_MINUTES } from '../config/monitoring';

interface MonitoramentoAttributes {
  id: string;
  advogadoId: string;
  processoId: string;
  intervaloMinutos: number;
  ativo: boolean;
  ultimoPoll?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

interface MonitoramentoCreationAttributes extends Optional<MonitoramentoAttributes, 'id' | 'ativo' | 'ultimoPoll' | 'createdAt' | 'updatedAt'> {}

class Monitoramento extends Model<MonitoramentoAttributes, MonitoramentoCreationAttributes> implements MonitoramentoAttributes {
  public id!: string;
  public advogadoId!: string;
  public processoId!: string;
  public intervaloMinutos!: number;
  public ativo!: boolean;
  public ultimoPoll?: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Monitoramento.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    advogadoId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'advogado_id',
      references: {
        model: 'advogados',
        key: 'id',
      },
    },
    processoId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'processo_id',
      references: {
        model: 'processos',
        key: 'id',
      },
    },
    intervaloMinutos: {
      type: DataTypes.INTEGER,
      defaultValue: DEFAULT_PROCESS_MONITORING_INTERVAL_MINUTES,
      field: 'intervalo_minutos',
    },
    ativo: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    ultimoPoll: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'ultimo_poll',
    },
  },
  {
    sequelize,
    tableName: 'monitoramentos',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['advogado_id', 'ativo'],
      },
      {
        fields: ['processo_id'],
      },
      {
        fields: ['ativo'],
      },
    ],
  }
);

export default Monitoramento;
