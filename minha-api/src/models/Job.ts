import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

type JobTipo = 'SCRAPE' | 'NOTIFY' | 'RETRY';
type JobStatus = 'PENDENTE' | 'PROCESSANDO' | 'CONCLUIDO' | 'FALHO';

interface JobAttributes {
  id: string;
  processoId?: string;
  tipo: JobTipo;
  status: JobStatus;
  payload?: object;
  erro?: string;
  scheduledAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  tentativas: number;
  maxTentativas: number;
  createdAt?: Date;
  updatedAt?: Date;
}

type JobCreationAttributes = Optional<JobAttributes, 'id' | 'processoId' | 'payload' | 'erro' | 'startedAt' | 'completedAt' | 'createdAt' | 'updatedAt'>;

class Job extends Model<JobAttributes, JobCreationAttributes> implements JobAttributes {
  public id!: string;
  public processoId?: string;
  public tipo!: JobTipo;
  public status!: JobStatus;
  public payload?: object;
  public erro?: string;
  public scheduledAt!: Date;
  public startedAt?: Date;
  public completedAt?: Date;
  public tentativas!: number;
  public maxTentativas!: number;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Job.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    processoId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'processo_id',
      references: {
        model: 'processos',
        key: 'id',
      },
    },
    tipo: {
      type: DataTypes.ENUM('SCRAPE', 'NOTIFY', 'RETRY'),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('PENDENTE', 'PROCESSANDO', 'CONCLUIDO', 'FALHO'),
      defaultValue: 'PENDENTE',
    },
    payload: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    erro: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    scheduledAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'scheduled_at',
    },
    startedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'started_at',
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'completed_at',
    },
    tentativas: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    maxTentativas: {
      type: DataTypes.INTEGER,
      defaultValue: 3,
      field: 'max_tentativas',
    },
  },
  {
    sequelize,
    tableName: 'jobs',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['processo_id'],
      },
      {
        fields: ['tipo'],
      },
      {
        fields: ['status', 'scheduled_at'],
      },
    ],
  }
);

export default Job;
