import { QueryInterface, DataTypes } from 'sequelize';

const TABLE_NAME = 'api_usage';

const normalizeTableName = (table: unknown): string => {
  if (typeof table === 'string') return table;
  if (table && typeof table === 'object' && 'tableName' in table) {
    return String((table as { tableName: string }).tableName);
  }
  return String(table);
};

export const up = async ({ context }: { context: QueryInterface }) => {
  const existingTables = new Set((await context.showAllTables()).map(normalizeTableName));
  if (existingTables.has(TABLE_NAME)) return;

  await context.createTable(TABLE_NAME, {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
    },
    advogado_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    actor_role: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    endpoint: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    metodo: {
      type: DataTypes.STRING(10),
      allowNull: false,
    },
    status_code: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    tribunal_codigo: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    latency_ms: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    cache_hit: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
    },
    result_status: {
      type: DataTypes.STRING(40),
      allowNull: true,
    },
    request_id: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  });

  await context.addIndex(TABLE_NAME, ['advogado_id']);
  await context.addIndex(TABLE_NAME, ['endpoint']);
  await context.addIndex(TABLE_NAME, ['created_at']);
  await context.addIndex(TABLE_NAME, ['tribunal_codigo']);
};

export const down = async ({ context }: { context: QueryInterface }) => {
  const existingTables = new Set((await context.showAllTables()).map(normalizeTableName));
  if (!existingTables.has(TABLE_NAME)) return;
  await context.dropTable(TABLE_NAME);
};

