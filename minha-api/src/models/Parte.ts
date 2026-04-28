import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

type ParteTipo = 'AUTOR' | 'REU' | 'ADVOGADO' | 'OUTRO' | 'LITISDENUNCIANTE' | 'LITISDENUNCIADO' | 'TERCEIRO';

interface ParteAttributes {
  id: string;
  processoId: string;
  tipo: ParteTipo;
  nome: string;
  documento?: string;
  isAdvogado: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ParteCreationAttributes extends Optional<ParteAttributes, 'id' | 'documento' | 'isAdvogado' | 'createdAt' | 'updatedAt'> {}

class Parte extends Model<ParteAttributes, ParteCreationAttributes> implements ParteAttributes {
  public id!: string;
  public processoId!: string;
  public tipo!: ParteTipo;
  public nome!: string;
  public documento?: string;
  public isAdvogado!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Parte.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
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
    tipo: {
      type: DataTypes.ENUM('AUTOR', 'REU', 'ADVOGADO', 'OUTRO', 'LITISDENUNCIANTE', 'LITISDENUNCIADO', 'TERCEIRO'),
      allowNull: false,
    },
    nome: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
    documento: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    isAdvogado: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_advogado',
    },
  },
  {
    sequelize,
    tableName: 'partes',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['processo_id'],
      },
      {
        fields: ['tipo'],
      },
    ],
  }
);

export default Parte;
