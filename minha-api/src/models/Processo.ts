import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

type ProcessoInstancia = 'PRIMEIRA' | 'SEGUNDA' | 'SUPERIOR';
type ProcessoStatus = 'MONITORANDO' | 'ARQUIVADO' | 'ENCERRADO' | 'ERRO';

interface ProcessoAttributes {
  id: string;
  numeroProcesso: string;
  tribunalId: string;
  advogadoId: string;
  classe?: string;
  assunto?: string;
  instancia: ProcessoInstancia;
  status: ProcessoStatus;
  primeiraInstancia?: Date;
  ultimaMovimentacao?: Date;
  dadosOriginais?: object;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ProcessoCreationAttributes extends Optional<ProcessoAttributes, 'id' | 'classe' | 'assunto' | 'dadosOriginais' | 'createdAt' | 'updatedAt'> {}

class Processo extends Model<ProcessoAttributes, ProcessoCreationAttributes> implements ProcessoAttributes {
  public id!: string;
  public numeroProcesso!: string;
  public tribunalId!: string;
  public advogadoId!: string;
  public classe?: string;
  public assunto?: string;
  public instancia!: ProcessoInstancia;
  public status!: ProcessoStatus;
  public primeiraInstancia?: Date;
  public ultimaMovimentacao?: Date;
  public dadosOriginais?: object;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Processo.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    numeroProcesso: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
      field: 'numero_processo',
      validate: {
        notEmpty: true,
      },
    },
    tribunalId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'tribunal_id',
      references: {
        model: 'tribunais',
        key: 'id',
      },
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
    classe: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    assunto: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    instancia: {
      type: DataTypes.ENUM('PRIMEIRA', 'SEGUNDA', 'SUPERIOR'),
      defaultValue: 'PRIMEIRA',
    },
    status: {
      type: DataTypes.ENUM('MONITORANDO', 'ARQUIVADO', 'ENCERRADO', 'ERRO'),
      defaultValue: 'MONITORANDO',
    },
    primeiraInstancia: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'primeira_instancia',
    },
    ultimaMovimentacao: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'ultima_movimentacao',
    },
    dadosOriginais: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: 'dados_originais',
    },
  },
  {
    sequelize,
    tableName: 'processos',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['numero_processo'],
      },
      {
        fields: ['tribunal_id'],
      },
      {
        fields: ['advogado_id'],
      },
      {
        fields: ['status'],
      },
      {
        fields: ['ultima_movimentacao'],
      },
    ],
  }
);

export default Processo;
