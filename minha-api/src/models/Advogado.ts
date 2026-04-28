import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

interface AdvogadoAttributes {
  id: string;
  oab: string;
  nome: string;
  email?: string;
  ativo: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface AdvogadoCreationAttributes extends Optional<AdvogadoAttributes, 'id' | 'email' | 'ativo' | 'createdAt' | 'updatedAt'> {}

class Advogado extends Model<AdvogadoAttributes, AdvogadoCreationAttributes> implements AdvogadoAttributes {
  public id!: string;
  public oab!: string;
  public nome!: string;
  public email?: string;
  public ativo!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Advogado.init(
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
      validate: {
        notEmpty: true,
      },
    },
    nome: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: true,
      validate: {
        isEmail: true,
      },
    },
    ativo: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    sequelize,
    tableName: 'advogados',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['oab'],
      },
      {
        fields: ['ativo'],
      },
    ],
  }
);

export default Advogado;
