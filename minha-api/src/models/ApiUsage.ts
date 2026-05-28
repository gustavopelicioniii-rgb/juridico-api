import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

interface ApiUsageAttributes {
  id: string;
  advogadoId?: string;
  actorRole?: string;
  endpoint: string;
  metodo: string;
  statusCode: number;
  tribunalCodigo?: string;
  latencyMs: number;
  cacheHit?: boolean;
  resultStatus?: string;
  requestId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

type ApiUsageCreationAttributes = Optional<ApiUsageAttributes, 'id' | 'advogadoId' | 'actorRole' | 'tribunalCodigo' | 'cacheHit' | 'resultStatus' | 'requestId' | 'createdAt' | 'updatedAt'>;

class ApiUsage extends Model<ApiUsageAttributes, ApiUsageCreationAttributes> implements ApiUsageAttributes {
  public id!: string;
  public advogadoId?: string;
  public actorRole?: string;
  public endpoint!: string;
  public metodo!: string;
  public statusCode!: number;
  public tribunalCodigo?: string;
  public latencyMs!: number;
  public cacheHit?: boolean;
  public resultStatus?: string;
  public requestId?: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

ApiUsage.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  advogadoId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'advogado_id',
  },
  actorRole: {
    type: DataTypes.STRING(20),
    allowNull: true,
    field: 'actor_role',
  },
  endpoint: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  metodo: {
    type: DataTypes.STRING(10),
    allowNull: false,
  },
  statusCode: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'status_code',
  },
  tribunalCodigo: {
    type: DataTypes.STRING(20),
    allowNull: true,
    field: 'tribunal_codigo',
  },
  latencyMs: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'latency_ms',
  },
  cacheHit: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    field: 'cache_hit',
  },
  resultStatus: {
    type: DataTypes.STRING(40),
    allowNull: true,
    field: 'result_status',
  },
  requestId: {
    type: DataTypes.STRING(100),
    allowNull: true,
    field: 'request_id',
  },
}, {
  sequelize,
  tableName: 'api_usage',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['advogado_id'] },
    { fields: ['endpoint'] },
    { fields: ['created_at'] },
    { fields: ['tribunal_codigo'] },
  ],
});

export default ApiUsage;
