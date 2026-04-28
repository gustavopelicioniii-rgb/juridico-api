import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

type TribunalTipo = 'TJ' | 'STJ' | 'STF' | 'TRT' | 'TRF';

interface TribunalAttributes {
  id: string;
  codigo: string;
  nome: string;
  baseUrl: string;
  tipo: TribunalTipo;
  usaCaptcha: boolean;
  scraperConfig?: object;
  ativo: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface TribunalCreationAttributes extends Optional<TribunalAttributes, 'id' | 'scraperConfig' | 'ativo' | 'createdAt' | 'updatedAt'> {}

class Tribunal extends Model<TribunalAttributes, TribunalCreationAttributes> implements TribunalAttributes {
  public id!: string;
  public codigo!: string;
  public nome!: string;
  public baseUrl!: string;
  public tipo!: TribunalTipo;
  public usaCaptcha!: boolean;
  public scraperConfig?: object;
  public ativo!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Tribunal.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    codigo: {
      type: DataTypes.STRING(10),
      allowNull: false,
      unique: true,
      validate: {
        notEmpty: true,
      },
    },
    nome: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
    baseUrl: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
    tipo: {
      type: DataTypes.ENUM('TJ', 'STJ', 'STF', 'TRT', 'TRF'),
      allowNull: false,
    },
    usaCaptcha: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    scraperConfig: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    ativo: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    sequelize,
    tableName: 'tribunais',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['codigo'],
      },
      {
        fields: ['ativo'],
      },
      {
        fields: ['tipo'],
      },
    ],
  }
);

export default Tribunal;
