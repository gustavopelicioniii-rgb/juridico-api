import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

interface MovimentacaoAttributes {
  id: string;
  processoId: string;
  descricao: string;
  data: Date;
  origem?: string;
  dadosOriginais?: object;
  nova: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

type MovimentacaoCreationAttributes = Optional<MovimentacaoAttributes, 'id' | 'origem' | 'dadosOriginais' | 'createdAt' | 'updatedAt'>;

class Movimentacao extends Model<MovimentacaoAttributes, MovimentacaoCreationAttributes> implements MovimentacaoAttributes {
  public id!: string;
  public processoId!: string;
  public descricao!: string;
  public data!: Date;
  public origem?: string;
  public dadosOriginais?: object;
  public nova!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Movimentacao.init(
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
    descricao: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
    data: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    origem: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    dadosOriginais: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: 'dados_originais',
    },
    nova: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    sequelize,
    tableName: 'movimentacoes',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['processo_id', 'data'],
      },
      {
        fields: ['processo_id'],
      },
      {
        fields: ['data'],
      },
      {
        fields: ['nova'],
      },
    ],
  }
);

export default Movimentacao;
