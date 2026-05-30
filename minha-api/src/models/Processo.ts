import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

type ProcessoInstancia = 'PRIMEIRA' | 'SEGUNDA' | 'SUPERIOR';
type ProcessoStatus = 'MONITORANDO' | 'ARQUIVADO' | 'ENCERRADO' | 'ERRO';

interface ProcessoAttributes {
  id: string;
  numeroProcesso: string;
  tribunalId?: string;
  advogadoId?: string;
  classe?: string;
  classeCodigo?: number;
  assunto?: string;
  assuntoPrincipal?: string;
  instancia: ProcessoInstancia;
  status: ProcessoStatus;
  primeiraInstancia?: Date;
  ultimaMovimentacao?: Date;
  /** Data de ajuizamento (primeira entrada no sistema) */
  dataAjuizamento?: Date;
  /** Valor da causa em centavos (para precisão monetária) */
  valorCausa?: number;
  /** Órgão julgador (vara/cartório) */
  orgaoJulgador?: string;
  orgaoJulgadorCodigo?: number;
  /** Nível de sigilo (0 = público, 1+ = sigiloso) */
  nivelSigilo?: number;
  sistema?: string;
  formato?: string;
  dadosOriginais?: object;
  /** Indica se o registro foi enriquecido via crawler (ESAJ/PJe) */
  enriquecido?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

type ProcessoCreationAttributes = Optional<ProcessoAttributes,
  'id' | 'tribunalId' | 'advogadoId' | 'classe' | 'classeCodigo' | 'assunto' | 'assuntoPrincipal'
  | 'instancia' | 'status' | 'dataAjuizamento' | 'valorCausa' | 'orgaoJulgador' | 'orgaoJulgadorCodigo'
  | 'nivelSigilo' | 'sistema' | 'formato' | 'dadosOriginais' | 'enriquecido'
  | 'createdAt' | 'updatedAt'>;

class Processo extends Model<ProcessoAttributes, ProcessoCreationAttributes> implements ProcessoAttributes {
  public id!: string;
  public numeroProcesso!: string;
  public tribunalId?: string;
  public advogadoId?: string;
  public classe?: string;
  public classeCodigo?: number;
  public assunto?: string;
  public assuntoPrincipal?: string;
  public instancia!: ProcessoInstancia;
  public status!: ProcessoStatus;
  public primeiraInstancia?: Date;
  public ultimaMovimentacao?: Date;
  public dataAjuizamento?: Date;
  public valorCausa?: number;
  public orgaoJulgador?: string;
  public orgaoJulgadorCodigo?: number;
  public nivelSigilo?: number;
  public sistema?: string;
  public formato?: string;
  public dadosOriginais?: object;
  public enriquecido?: boolean;
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
      allowNull: true,
      field: 'tribunal_id',
    },
    advogadoId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'advogado_id',
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
    dataAjuizamento: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'data_ajuizamento',
    },
    valorCausa: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    orgaoJulgador: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'orgao_julgador',
    },
    orgaoJulgadorCodigo: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'orgao_julgador_codigo',
    },
    nivelSigilo: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'nivel_sigilo',
    },
    sistema: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    formato: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    classeCodigo: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'classe_codigo',
    },
    assuntoPrincipal: {
      type: DataTypes.STRING(500),
      allowNull: true,
      field: 'assunto_principal',
    },
    dadosOriginais: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: 'dados_originais',
    },
    enriquecido: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
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
