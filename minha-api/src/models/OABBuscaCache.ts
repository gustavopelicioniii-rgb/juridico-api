import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

interface OABBuscaCacheAttributes {
  id: string;
  oab: string;
  tribunalCodigo: string;
  resultadoJson: Record<string, unknown>;
  totalProcessos: number;
  criadoEm: Date;
  expiraEm: Date;
}

interface OABBuscaCacheCreationAttributes extends Optional<OABBuscaCacheAttributes, 'id' | 'criadoEm' | 'expiraEm'> {}

class OABBuscaCache extends Model<OABBuscaCacheAttributes, OABBuscaCacheCreationAttributes> implements OABBuscaCacheAttributes {
  public id!: string;
  public oab!: string;
  public tribunalCodigo!: string;
  public resultadoJson!: Record<string, unknown>;
  public totalProcessos!: number;
  public readonly criadoEm!: Date;
  public readonly expiraEm!: Date;
}

OABBuscaCache.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    oab: {
      type: DataTypes.STRING(20),
      allowNull: false,
      field: 'oab',
    },
    tribunalCodigo: {
      type: DataTypes.STRING(10),
      allowNull: false,
      field: 'tribunal_codigo',
    },
    resultadoJson: {
      type: DataTypes.JSONB,
      allowNull: false,
      field: 'resultado_json',
    },
    totalProcessos: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'total_processos',
    },
    criadoEm: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'criado_em',
    },
    expiraEm: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'expira_em',
    },
  },
  {
    sequelize,
    tableName: 'oab_busca_cache',
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ['oab', 'tribunal_codigo'],
        name: 'oab_tribunal_unique',
      },
      {
        fields: ['oab'],
      },
      {
        fields: ['expira_em'],
      },
    ],
  }
);

export default OABBuscaCache;
