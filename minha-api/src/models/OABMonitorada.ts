import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

interface OABMonitoradaAttributes {
  id: string;
  oab: string;
  ativo: boolean;
  intervaloMinutos: number;
  usuarioId?: number | null;
  ultimaVerificacao?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

type OABMonitoradaCreationAttributes =
  Optional<OABMonitoradaAttributes, 'id' | 'ativo' | 'intervaloMinutos' | 'usuarioId' | 'ultimaVerificacao' | 'createdAt' | 'updatedAt'>;

class OABMonitorada
  extends Model<OABMonitoradaAttributes, OABMonitoradaCreationAttributes>
  implements OABMonitoradaAttributes
{
  public id!: string;
  public oab!: string;
  public ativo!: boolean;
  public intervaloMinutos!: number;
  public usuarioId?: number | null;
  public ultimaVerificacao?: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

OABMonitorada.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    oab: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true,
      field: 'oab',
    },
    ativo: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    intervaloMinutos: {
      type: DataTypes.INTEGER,
      defaultValue: 5,
      field: 'intervalo_minutos',
    },
    usuarioId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'usuario_id',
    },
    ultimaVerificacao: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'ultima_verificacao',
    },
  },
  {
    sequelize,
    tableName: 'oabs_monitoradas',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['oab'], unique: true },
      { fields: ['ativo'] },
      { fields: ['usuario_id'] },
    ],
  }
);

export default OABMonitorada;
