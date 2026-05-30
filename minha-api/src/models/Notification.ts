import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

type NotificationTipo = 'NOVA_MOVIMENTACAO' | 'SCRAPING_COMPLETO' | 'ERRO_SCRAPING' | 'PROCESSO_ATUALIZADO';

interface NotificationAttributes {
  id: string;
  advogadoId: string;
  processoId?: string;
  tipo: NotificationTipo;
  mensagem: string;
  lida: boolean;
  dados?: object;
  createdAt?: Date;
  updatedAt?: Date;
}

type NotificationCreationAttributes = Optional<NotificationAttributes, 'id' | 'processoId' | 'dados' | 'lida' | 'createdAt' | 'updatedAt'>;

class Notification extends Model<NotificationAttributes, NotificationCreationAttributes> implements NotificationAttributes {
  public id!: string;
  public advogadoId!: string;
  public processoId?: string;
  public tipo!: NotificationTipo;
  public mensagem!: string;
  public lida!: boolean;
  public dados?: object;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Notification.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    advogadoId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'advogado_id',
    },
    processoId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'processo_id',
    },
    tipo: {
      type: DataTypes.ENUM('NOVA_MOVIMENTACAO', 'SCRAPING_COMPLETO', 'ERRO_SCRAPING', 'PROCESSO_ATUALIZADO'),
      allowNull: false,
    },
    mensagem: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    lida: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    dados: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'notifications',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['advogado_id', 'lida'] },
      { fields: ['processo_id'] },
      { fields: ['created_at'] },
    ],
  }
);

export default Notification;
